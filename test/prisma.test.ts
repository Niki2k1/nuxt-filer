import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useStorage } from 'nitropack/runtime'
import { createPrismaProvider } from '../src/runtime/server/providers/prisma'
import type { PrismaFileDelegate, PrismaFileRecord } from '../src/runtime/server/providers/prisma'

// Back the provider's `useStorage()` with an in-memory unstorage instance so
// the binary side of the provider works without a running Nitro server. A
// single shared instance is returned for every mount name. `vi.mock` is
// hoisted above the imports above, so this is registered before the provider
// module loads.
vi.mock('nitropack/runtime', async () => {
  const { createStorage } = await import('unstorage')
  const memoryDriver = (await import('unstorage/drivers/memory')).default
  const storage = createStorage({ driver: memoryDriver() })
  return { useStorage: () => storage }
})

/**
 * Minimal in-memory stand-in for a Prisma model delegate, backed by a Map.
 * Matches the structural `PrismaFileDelegate` surface the provider relies on.
 */
function createFakeDelegate(): PrismaFileDelegate & { rows: Map<string, PrismaFileRecord> } {
  const rows = new Map<string, PrismaFileRecord>()
  const matches = (row: PrismaFileRecord, where: Record<string, unknown>) =>
    Object.entries(where).every(([k, v]) => {
      // JSON-path filter (postgres-jsonpath strategy): { path: [key], equals }
      if (v && typeof v === 'object' && 'path' in (v as object)) {
        const { path, equals } = v as { path: string[]; equals: unknown }
        const meta = row.metadata as Record<string, unknown> | undefined
        return meta?.[path[0]!] === equals
      }
      return row[k] === v
    })

  return {
    rows,
    async create({ data }) {
      const row: PrismaFileRecord = {
        ...data,
        id: data.id as string,
        createdAt: new Date('2020-01-01T00:00:00Z'),
        updatedAt: new Date('2020-01-01T00:00:00Z'),
      }
      rows.set(row.id, row)
      return row
    },
    async findUnique({ where }) {
      return rows.get(where.id) ?? null
    },
    async findFirst({ where }) {
      for (const row of rows.values()) if (matches(row, where)) return row
      return null
    },
    async findMany({ where }) {
      return [...rows.values()].filter((row) => matches(row, where))
    },
    async update({ where, data }) {
      const row = rows.get(where.id)
      if (!row) throw new Error('not found')
      Object.assign(row, data, { updatedAt: new Date('2020-02-02T00:00:00Z') })
      return row
    },
    async deleteMany({ where }) {
      let count = 0
      for (const [id, row] of rows) {
        if (matches(row, where)) {
          rows.delete(id)
          count++
        }
      }
      return { count }
    },
    async count({ where }) {
      return [...rows.values()].filter((row) => matches(row, where)).length
    },
  }
}

const META = { name: 'a.txt', mime: 'text/plain', type: 'document', version: 1 }

describe('createPrismaProvider', () => {
  let delegate: ReturnType<typeof createFakeDelegate>

  beforeEach(async () => {
    delegate = createFakeDelegate()
    await useStorage('documents').clear()
  })

  function provider(findByMeta: 'scan' | 'postgres-jsonpath' = 'scan') {
    return createPrismaProvider(delegate, { storageName: 'documents', findByMeta })
  }

  it('runs the full CRUD lifecycle', async () => {
    const p = provider()

    // create
    const { id } = await p.create('g1', Buffer.from('hello world'), { ...META })
    expect(id).toBeTruthy()
    expect(delegate.rows.size).toBe(1)
    expect(delegate.rows.get(id)!.groupId).toBe('g1')

    // get — data + meta + timestamps
    const file = await p.get('g1', id)
    expect(file).not.toBeNull()
    expect(file!.data?.toString()).toBe('hello world')
    expect(file!.meta.name).toBe('a.txt')
    expect(file!.createdAt).toBeInstanceOf(Date)

    // getData
    const data = await p.getData('g1', id)
    expect(data?.toString()).toBe('hello world')

    // getMeta — cross-group lookup by id only
    const meta = await p.getMeta(id)
    expect(meta?.mime).toBe('text/plain')

    // list — omits binary data
    const list = await p.list('g1')
    expect(list).toHaveLength(1)
    expect(list[0]!.id).toBe(id)
    expect(list[0]!.data).toBeUndefined()

    // update — shallow merge preserves existing fields
    await p.update(id, { comment: 'updated' })
    const afterUpdate = await p.getMeta(id)
    expect(afterUpdate?.comment).toBe('updated')
    expect(afterUpdate?.name).toBe('a.txt')

    // findByMeta (scan)
    const found = await p.findByMeta({ key: 'name', value: 'a.txt', groupId: 'g1' })
    expect(found?.id).toBe(id)
    const missing = await p.findByMeta({ key: 'name', value: 'nope.txt' })
    expect(missing).toBeNull()

    // has
    expect(await p.has('g1', id)).toBe(true)

    // remove — drops row + binary
    await p.remove('g1', id)
    expect(await p.has('g1', id)).toBe(false)
    expect(await p.getData('g1', id)).toBeNull()
    expect(delegate.rows.size).toBe(0)
  })

  it('clears only the target group', async () => {
    const p = provider()
    await p.create('g1', Buffer.from('one'), { ...META })
    await p.create('g1', Buffer.from('two'), { ...META })
    const other = await p.create('g2', Buffer.from('keep'), { ...META })

    await p.clear('g1')

    expect(await p.list('g1')).toHaveLength(0)
    expect(await p.getData('g1', other.id)).toBeNull()
    // g2 untouched
    expect(await p.list('g2')).toHaveLength(1)
    expect((await p.getData('g2', other.id))?.toString()).toBe('keep')
  })

  it('scopes reads by groupId', async () => {
    const p = provider()
    const { id } = await p.create('g1', Buffer.from('x'), { ...META })

    // A different group must not surface the row's metadata.
    const wrongGroup = await p.get('g2', id)
    expect(wrongGroup).toBeNull()

    // list of an unrelated group is empty.
    expect(await p.list('g2')).toEqual([])
  })

  it('supports the postgres-jsonpath findByMeta strategy', async () => {
    const p = provider('postgres-jsonpath')
    const { id } = await p.create('g1', Buffer.from('x'), { ...META, name: 'unique.txt' })

    const found = await p.findByMeta({ key: 'name', value: 'unique.txt', groupId: 'g1' })
    expect(found?.id).toBe(id)
    const missing = await p.findByMeta({ key: 'name', value: 'absent.txt' })
    expect(missing).toBeNull()
  })

  it('throws when updating a missing file', async () => {
    const p = provider()
    await expect(p.update('does-not-exist', { comment: 'x' })).rejects.toThrow(/not found/i)
  })
})
