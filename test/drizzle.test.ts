import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useStorage } from 'nitropack/runtime'
import { createDrizzleProvider } from '../src/runtime/server/providers/drizzle'
import type { DrizzleRow } from '../src/runtime/server/providers/drizzle'

// Back the provider's `useStorage()` with an in-memory unstorage instance so
// the binary side works without a running Nitro server. `vi.mock` is hoisted
// above the imports, so this is registered before the provider module loads.
vi.mock('nitropack/runtime', async () => {
  const { createStorage } = await import('unstorage')
  const memoryDriver = (await import('unstorage/drivers/memory')).default
  const storage = createStorage({ driver: memoryDriver() })
  return { useStorage: () => storage }
})

// --- Fake Drizzle: operators produce row predicates; the db is an array. ---

type Predicate = (row: DrizzleRow) => boolean

const eq = (col: unknown, val: unknown): Predicate => (row) => row[col as string] === val
const and = (...preds: unknown[]): Predicate => (row) => (preds as Predicate[]).every((p) => p(row))
// Emulates `metadata ->> key = value` (text comparison), Postgres-jsonb style.
const sql = (_strings: TemplateStringsArray, ...values: unknown[]): Predicate => {
  const [colName, key, val] = values as [string, string, string]
  return (row) => String((row[colName] as Record<string, unknown> | undefined)?.[key]) === val
}

class SelectBuilder {
  constructor(
    private rows: DrizzleRow[],
    private pred: Predicate | null = null,
    private lim: number | null = null
  ) {}
  where(pred: unknown) {
    return new SelectBuilder(this.rows, pred as Predicate, this.lim)
  }
  limit(n: number) {
    return new SelectBuilder(this.rows, this.pred, n)
  }
  private run(): DrizzleRow[] {
    let out = this.rows.map((r) => ({ ...r }))
    if (this.pred) out = out.filter(this.pred)
    if (this.lim != null) out = out.slice(0, this.lim)
    return out
  }
  then<T>(resolve: (rows: DrizzleRow[]) => T, reject?: (e: unknown) => T) {
    return Promise.resolve(this.run()).then(resolve, reject)
  }
}

function createFakeDb() {
  const rows: DrizzleRow[] = []
  return {
    rows,
    insert() {
      return {
        async values(v: DrizzleRow) {
          rows.push({ ...v })
        },
      }
    },
    select() {
      return { from: () => new SelectBuilder(rows) }
    },
    update() {
      return {
        set(v: DrizzleRow) {
          return {
            async where(pred: unknown) {
              for (const r of rows) if ((pred as Predicate)(r)) Object.assign(r, v)
            },
          }
        },
      }
    },
    delete() {
      return {
        async where(pred: unknown) {
          for (let i = rows.length - 1; i >= 0; i--) {
            if ((pred as Predicate)(rows[i]!)) rows.splice(i, 1)
          }
        },
      }
    },
  }
}

// Table columns are markers equal to their property name, so eq(table.x, v)
// filters on row['x'].
const table = {
  id: 'id',
  groupId: 'groupId',
  metadata: 'metadata',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
}

const META = { name: 'a.txt', mime: 'text/plain', type: 'document', version: 1 }

describe('createDrizzleProvider', () => {
  let db: ReturnType<typeof createFakeDb>

  beforeEach(async () => {
    db = createFakeDb()
    await useStorage('documents').clear()
  })

  function provider(findByMeta: 'scan' | 'postgres-jsonb' = 'scan') {
    return createDrizzleProvider({
      storageName: 'documents',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      db: db as any,
      table,
      operators: { eq, and, sql },
      findByMeta,
    })
  }

  it('runs the full CRUD lifecycle', async () => {
    const p = provider()

    const { id } = await p.create('g1', Buffer.from('hello world'), { ...META })
    expect(id).toBeTruthy()
    expect(db.rows).toHaveLength(1)
    expect(db.rows[0]!.groupId).toBe('g1')

    const file = await p.get('g1', id)
    expect(file!.data?.toString()).toBe('hello world')
    expect(file!.meta.name).toBe('a.txt')
    expect(file!.createdAt).toBeInstanceOf(Date)

    expect((await p.getData('g1', id))?.toString()).toBe('hello world')
    expect((await p.getMeta(id))?.mime).toBe('text/plain')

    const list = await p.list('g1')
    expect(list).toHaveLength(1)
    expect(list[0]!.id).toBe(id)
    expect(list[0]!.data).toBeUndefined()

    await p.update(id, { comment: 'updated' })
    const updated = await p.getMeta(id)
    expect(updated?.comment).toBe('updated')
    expect(updated?.name).toBe('a.txt')

    const found = await p.findByMeta({ key: 'name', value: 'a.txt', groupId: 'g1' })
    expect(found?.id).toBe(id)
    expect(await p.findByMeta({ key: 'name', value: 'nope.txt' })).toBeNull()

    expect(await p.has('g1', id)).toBe(true)

    await p.remove('g1', id)
    expect(await p.has('g1', id)).toBe(false)
    expect(await p.getData('g1', id)).toBeNull()
    expect(db.rows).toHaveLength(0)
  })

  it('clears only the target group', async () => {
    const p = provider()
    await p.create('g1', Buffer.from('one'), { ...META })
    await p.create('g1', Buffer.from('two'), { ...META })
    const other = await p.create('g2', Buffer.from('keep'), { ...META })

    await p.clear('g1')

    expect(await p.list('g1')).toHaveLength(0)
    expect(await p.getData('g1', other.id)).toBeNull()
    expect(await p.list('g2')).toHaveLength(1)
    expect((await p.getData('g2', other.id))?.toString()).toBe('keep')
  })

  it('scopes reads by groupId', async () => {
    const p = provider()
    const { id } = await p.create('g1', Buffer.from('x'), { ...META })

    expect(await p.get('g2', id)).toBeNull()
    expect(await p.list('g2')).toEqual([])
  })

  it('supports the postgres-jsonb findByMeta strategy', async () => {
    const p = provider('postgres-jsonb')
    const { id } = await p.create('g1', Buffer.from('x'), { ...META, name: 'unique.txt' })

    const found = await p.findByMeta({ key: 'name', value: 'unique.txt', groupId: 'g1' })
    expect(found?.id).toBe(id)
    expect(await p.findByMeta({ key: 'name', value: 'absent.txt' })).toBeNull()
  })

  it('throws when postgres-jsonb is selected without the sql operator', async () => {
    const p = createDrizzleProvider({
      storageName: 'documents',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      db: db as any,
      table,
      operators: { eq, and },
      findByMeta: 'postgres-jsonb',
    })
    await expect(p.findByMeta({ key: 'name', value: 'x' })).rejects.toThrow(/requires the `sql` operator/)
  })

  it('throws when updating a missing file', async () => {
    const p = provider()
    await expect(p.update('does-not-exist', { comment: 'x' })).rejects.toThrow(/not found/i)
  })
})
