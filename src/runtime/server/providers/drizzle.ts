import { randomUUID } from 'node:crypto';
import { useStorage } from 'nitropack/runtime';
import type {
  FileStorageProvider,
  FileMeta,
  StoredFile,
} from '../../../runtime/types';

/**
 * A Drizzle column reference (e.g. `table.groupId`). Opaque to this provider —
 * it is only ever handed back to the injected `eq`/`and` operators.
 */
export type DrizzleColumn = unknown;

/** A Drizzle table object: column references keyed by their schema property name. */
export type DrizzleTable = Record<string, DrizzleColumn>;

/** A row returned by a select, keyed by column property name. */
export type DrizzleRow = Record<string, unknown>;

/**
 * The thenable query builder Drizzle returns for `select().from()` and after
 * `.where()`. Awaiting it runs the query (async drivers); `.where()`/`.limit()`
 * refine it first.
 */
export interface DrizzleSelectBuilder extends PromiseLike<DrizzleRow[]> {
  where(condition: unknown): DrizzleSelectBuilder;
  limit(n: number): DrizzleSelectBuilder;
}

/**
 * The structural subset of a Drizzle database this provider uses — the core
 * query builder, which is stable across Drizzle v0.x and v1 (v1's changes are
 * to the relational `db.query` API, not this). Typed structurally so the
 * package builds and tests without `drizzle-orm` installed.
 */
export interface DrizzleDatabase {
  insert(table: DrizzleTable): {
    values(values: DrizzleRow): PromiseLike<unknown>;
  };
  select(): { from(table: DrizzleTable): DrizzleSelectBuilder };
  update(table: DrizzleTable): {
    set(values: DrizzleRow): { where(condition: unknown): PromiseLike<unknown> };
  };
  delete(table: DrizzleTable): {
    where(condition: unknown): PromiseLike<unknown>;
  };
}

/** Drizzle filter operators, injected from `drizzle-orm` by the caller. */
export interface DrizzleOperators {
  eq(column: DrizzleColumn, value: unknown): unknown;
  and(...conditions: unknown[]): unknown;
  /** The `sql` tagged template. Required only for `findByMeta: 'postgres-jsonb'`. */
  sql?: (strings: TemplateStringsArray, ...values: unknown[]) => unknown;
}

export interface CreateDrizzleProviderOptions {
  /** Nitro storage mount name used for binary file data. */
  storageName: string;
  /** The Drizzle database instance (core query builder). */
  db: DrizzleDatabase;
  /** The Drizzle table holding file metadata. */
  table: DrizzleTable;
  /** Filter operators from `drizzle-orm` (`{ eq, and, sql? }`). */
  operators: DrizzleOperators;
  /** Primary-key column (schema property name). Default: `'id'`. */
  idColumn?: string;
  /** Group-id column (schema property name). Default: `'groupId'`. */
  groupIdColumn?: string;
  /** JSON metadata column (schema property name). Default: `'metadata'`. */
  metadataColumn?: string;
  /** Optional created-at column; set on insert when present. Default: `'createdAt'`. */
  createdAtColumn?: string;
  /** Optional updated-at column; set on insert/update when present. Default: `'updatedAt'`. */
  updatedAtColumn?: string;
  /**
   * How {@link FileStorageProvider.findByMeta} queries the metadata column.
   * - `'scan'` (default): fetch rows by group and filter in JS. Portable across
   *   every dialect; matches the unstorage provider's semantics.
   * - `'postgres-jsonb'`: push the filter into a `jsonb ->> key = value` query
   *   via the injected `sql` operator. Efficient, but Postgres-only and
   *   compares as text.
   */
  findByMeta?: 'scan' | 'postgres-jsonb';
}

const EMPTY_META: FileMeta = { name: '', mime: '', type: '', version: 0 };

function asMeta(value: unknown): FileMeta {
  if (!value || typeof value !== 'object') return { ...EMPTY_META };
  return value as FileMeta;
}

function asDate(value: unknown): Date | undefined {
  if (value instanceof Date) return value;
  if (typeof value === 'string' || typeof value === 'number') {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? undefined : d;
  }
  return undefined;
}

/**
 * Drizzle-backed file storage provider for nuxt-filer.
 *
 * Metadata lives in a database table (via the supplied Drizzle `db` + `table`);
 * binary data lives in a Nitro storage mount (the same `useStorage()` machinery
 * the built-in unstorage provider uses), keyed `${groupId}:${id}`. The row
 * stores only metadata, never the bytes.
 *
 * The `db`, `table` and operators are injected, so there is no hard dependency
 * on `drizzle-orm` — pass your database instance, table, and `{ eq, and }` from
 * `drizzle-orm`. Targets async drivers (postgres-js, node-postgres, libsql,
 * mysql2, neon, …), which is the Nitro norm.
 */
export function createDrizzleProvider(
  options: CreateDrizzleProviderOptions
): FileStorageProvider {
  const {
    storageName,
    db,
    table,
    operators,
    idColumn = 'id',
    groupIdColumn = 'groupId',
    metadataColumn = 'metadata',
    createdAtColumn = 'createdAt',
    updatedAtColumn = 'updatedAt',
    findByMeta = 'scan',
  } = options;
  const { eq, and, sql } = operators;

  function getStorage() {
    return useStorage(storageName);
  }

  function dataKey(groupId: string, id: string) {
    return `${groupId}:${id}`;
  }

  /** Column ref by property name; throws early if the schema lacks it. */
  function col(name: string): DrizzleColumn {
    if (!(name in table)) {
      throw new Error(
        `nuxt-filer: column '${name}' not found on the configured Drizzle table.`
      );
    }
    return table[name];
  }

  const idCol = col(idColumn);
  const groupCol = col(groupIdColumn);
  const hasCreatedAt = createdAtColumn in table;
  const hasUpdatedAt = updatedAtColumn in table;

  function toStoredFile(row: DrizzleRow, data?: Buffer): StoredFile {
    return {
      id: String(row[idColumn]),
      groupId: String(row[groupIdColumn]),
      data,
      meta: asMeta(row[metadataColumn]),
      createdAt: hasCreatedAt ? asDate(row[createdAtColumn]) : undefined,
      updatedAt: hasUpdatedAt ? asDate(row[updatedAtColumn]) : undefined,
    };
  }

  async function findRowById(id: string): Promise<DrizzleRow | undefined> {
    const rows = await db.select().from(table).where(eq(idCol, id)).limit(1);
    return rows[0];
  }

  return {
    async create(groupId, data, meta) {
      const id = randomUUID();

      await getStorage().setItemRaw(
        dataKey(groupId, id),
        Buffer.isBuffer(data) ? data : Buffer.from(data)
      );

      const now = new Date();
      await db.insert(table).values({
        [idColumn]: id,
        [groupIdColumn]: groupId,
        [metadataColumn]: meta ?? null,
        ...(hasCreatedAt ? { [createdAtColumn]: now } : {}),
        ...(hasUpdatedAt ? { [updatedAtColumn]: now } : {}),
      });

      return { id };
    },

    async get(groupId, id) {
      const data = await getStorage().getItemRaw<Buffer>(dataKey(groupId, id));
      const row = await findRowById(id);

      // Only surface the row when it belongs to the requested group.
      const owned = row && row[groupIdColumn] === groupId ? row : undefined;

      if (!data && !owned) return null;

      if (!owned) {
        return { id, groupId, data: data ?? undefined, meta: { ...EMPTY_META } };
      }

      return toStoredFile(owned, data ?? undefined);
    },

    async getData(groupId, id) {
      return await getStorage().getItemRaw<Buffer>(dataKey(groupId, id));
    },

    async getMeta(id) {
      // No group scoping: matches the unstorage provider's cross-group lookup.
      const row = await findRowById(id);
      if (!row) return null;
      return asMeta(row[metadataColumn]);
    },

    async list(groupId) {
      const rows = await db
        .select()
        .from(table)
        .where(eq(groupCol, groupId));
      // list() omits binary data, like the unstorage provider.
      return rows.map((row) => toStoredFile(row));
    },

    async update(id, meta) {
      const existing = await findRowById(id);
      if (!existing) throw new Error(`File metadata not found: ${id}`);

      await db
        .update(table)
        .set({
          [metadataColumn]: { ...asMeta(existing[metadataColumn]), ...meta },
          ...(hasUpdatedAt ? { [updatedAtColumn]: new Date() } : {}),
        })
        .where(eq(idCol, id));
    },

    async remove(groupId, id) {
      await getStorage().removeItem(dataKey(groupId, id));
      await db
        .delete(table)
        .where(and(eq(idCol, id), eq(groupCol, groupId)));
    },

    async clear(groupId) {
      await db.delete(table).where(eq(groupCol, groupId));

      const storage = getStorage();
      const keys = await storage.getKeys(groupId);
      for (const key of keys) {
        await storage.removeItem(key);
      }
    },

    async has(groupId, id) {
      const rows = await db
        .select()
        .from(table)
        .where(and(eq(idCol, id), eq(groupCol, groupId)))
        .limit(1);
      return rows.length > 0;
    },

    async findByMeta(filter) {
      if (findByMeta === 'postgres-jsonb') {
        if (!sql) {
          throw new Error(
            "nuxt-filer: findByMeta 'postgres-jsonb' requires the `sql` operator from drizzle-orm to be provided."
          );
        }
        const metaCol = col(metadataColumn);
        const condition = sql`${metaCol} ->> ${filter.key} = ${String(filter.value)}`;
        const where = filter.groupId
          ? and(eq(groupCol, filter.groupId), condition)
          : condition;
        const rows = await db.select().from(table).where(where).limit(1);
        return rows[0] ? toStoredFile(rows[0]) : null;
      }

      // 'scan': portable JS filter, matching unstorage semantics.
      const rows = await (filter.groupId
        ? db.select().from(table).where(eq(groupCol, filter.groupId))
        : db.select().from(table));
      for (const row of rows) {
        const meta = asMeta(row[metadataColumn]);
        if (meta[filter.key] === filter.value) {
          return toStoredFile(row);
        }
      }
      return null;
    },
  };
}
