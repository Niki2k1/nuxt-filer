import { randomUUID } from 'node:crypto';
import { useStorage } from 'nitropack/runtime';
import type {
  FileStorageProvider,
  FileMeta,
  StoredFile,
} from '../../../runtime/types';

/**
 * A single row of the file-metadata table, as returned by the Prisma model
 * delegate. The metadata and group-id columns are configurable
 * ({@link CreatePrismaProviderOptions.metadataColumn} /
 * {@link CreatePrismaProviderOptions.groupIdColumn}) so this stays loosely
 * typed via an index signature.
 */
export interface PrismaFileRecord {
  id: string;
  createdAt?: Date | null;
  updatedAt?: Date | null;
  [column: string]: unknown;
}

/**
 * The structural subset of a Prisma model delegate (e.g. `prisma.filerFile`)
 * that this provider uses. Typed structurally so the package builds and the
 * factory is usable without `@prisma/client` installed — any object exposing
 * these methods works.
 */
export interface PrismaFileDelegate {
  create(args: { data: Record<string, unknown> }): Promise<PrismaFileRecord>;
  findUnique(args: {
    where: { id: string };
  }): Promise<PrismaFileRecord | null>;
  findFirst(args: {
    where: Record<string, unknown>;
  }): Promise<PrismaFileRecord | null>;
  findMany(args: {
    where: Record<string, unknown>;
  }): Promise<PrismaFileRecord[]>;
  update(args: {
    where: { id: string };
    data: Record<string, unknown>;
  }): Promise<PrismaFileRecord>;
  deleteMany(args: {
    where: Record<string, unknown>;
  }): Promise<{ count: number }>;
  count(args: { where: Record<string, unknown> }): Promise<number>;
}

export interface CreatePrismaProviderOptions {
  /** Nitro storage mount name used for binary file data. */
  storageName: string;
  /**
   * Name of the column holding the group id. Default: `'groupId'`.
   * (wrench's schema, for example, uses `'serviceorderId'`.)
   */
  groupIdColumn?: string;
  /** Name of the JSON column holding the file metadata. Default: `'metadata'`. */
  metadataColumn?: string;
  /**
   * How {@link FileStorageProvider.findByMeta} queries the metadata column.
   * - `'scan'` (default): fetch rows by group and filter in JS. Portable across
   *   every database Prisma supports; matches the unstorage provider's
   *   semantics.
   * - `'postgres-jsonpath'`: push the filter into a Prisma JSON-path `where`
   *   (`{ path: [key], equals: value }`). Efficient, but Postgres-only.
   */
  findByMeta?: 'scan' | 'postgres-jsonpath';
}

const EMPTY_META: FileMeta = { name: '', mime: '', type: '', version: 0 };

function asMeta(value: unknown): FileMeta {
  if (!value || typeof value !== 'object') return { ...EMPTY_META };
  return value as FileMeta;
}

/**
 * Prisma-backed file storage provider for nuxt-filer.
 *
 * Metadata lives in a database table (via the supplied Prisma model delegate);
 * binary data lives in a Nitro storage mount (the same `useStorage()` machinery
 * the built-in unstorage provider uses), keyed `${groupId}:${id}`. The DB row
 * stores only metadata, never the bytes.
 *
 * The delegate is typed structurally, so there is no hard dependency on
 * `@prisma/client` — pass `prisma.filerFile` (or whatever you named the model).
 */
export function createPrismaProvider(
  delegate: PrismaFileDelegate,
  options: CreatePrismaProviderOptions
): FileStorageProvider {
  const {
    storageName,
    groupIdColumn = 'groupId',
    metadataColumn = 'metadata',
    findByMeta = 'scan',
  } = options;

  function getStorage() {
    return useStorage(storageName);
  }

  function dataKey(groupId: string, id: string) {
    return `${groupId}:${id}`;
  }

  function toStoredFile(
    row: PrismaFileRecord,
    groupId: string,
    data?: Buffer
  ): StoredFile {
    return {
      id: row.id,
      groupId,
      data,
      meta: asMeta(row[metadataColumn]),
      createdAt: row.createdAt ?? undefined,
      updatedAt: row.updatedAt ?? undefined,
    };
  }

  return {
    async create(groupId, data, meta) {
      const id = randomUUID();

      await getStorage().setItemRaw(
        dataKey(groupId, id),
        Buffer.isBuffer(data) ? data : Buffer.from(data)
      );

      await delegate.create({
        data: {
          id,
          [groupIdColumn]: groupId,
          [metadataColumn]: meta ?? undefined,
        },
      });

      return { id };
    },

    async get(groupId, id) {
      const data = await getStorage().getItemRaw<Buffer>(dataKey(groupId, id));
      const row = await delegate.findUnique({ where: { id } });

      // Only surface the row when it belongs to the requested group.
      const owned = row && row[groupIdColumn] === groupId ? row : null;

      if (!data && !owned) return null;

      if (!owned) {
        return {
          id,
          groupId,
          data: data ?? undefined,
          meta: { ...EMPTY_META },
        };
      }

      return toStoredFile(owned, groupId, data ?? undefined);
    },

    async getData(groupId, id) {
      return await getStorage().getItemRaw<Buffer>(dataKey(groupId, id));
    },

    async getMeta(id) {
      // No group scoping: matches the unstorage provider's cross-group lookup.
      const row = await delegate.findUnique({ where: { id } });
      if (!row) return null;
      return asMeta(row[metadataColumn]);
    },

    async list(groupId) {
      const rows = await delegate.findMany({
        where: { [groupIdColumn]: groupId },
      });
      // list() omits binary data, like the unstorage provider.
      return rows.map((row) => toStoredFile(row, groupId));
    },

    async update(id, meta) {
      const existing = await delegate.findUnique({ where: { id } });
      if (!existing) throw new Error(`File metadata not found: ${id}`);

      await delegate.update({
        where: { id },
        data: {
          [metadataColumn]: { ...asMeta(existing[metadataColumn]), ...meta },
        },
      });
    },

    async remove(groupId, id) {
      await getStorage().removeItem(dataKey(groupId, id));
      await delegate.deleteMany({ where: { id, [groupIdColumn]: groupId } });
    },

    async clear(groupId) {
      await delegate.deleteMany({ where: { [groupIdColumn]: groupId } });

      const storage = getStorage();
      const keys = await storage.getKeys(groupId);
      for (const key of keys) {
        await storage.removeItem(key);
      }
    },

    async has(groupId, id) {
      const count = await delegate.count({
        where: { id, [groupIdColumn]: groupId },
      });
      return count > 0;
    },

    async findByMeta(filter) {
      if (findByMeta === 'postgres-jsonpath') {
        const row = await delegate.findFirst({
          where: {
            ...(filter.groupId ? { [groupIdColumn]: filter.groupId } : {}),
            [metadataColumn]: { path: [filter.key], equals: filter.value },
          },
        });
        if (!row) return null;
        return toStoredFile(row, String(row[groupIdColumn]));
      }

      // 'scan': portable JS filter, matching unstorage semantics.
      const rows = await delegate.findMany({
        where: filter.groupId ? { [groupIdColumn]: filter.groupId } : {},
      });
      for (const row of rows) {
        const meta = asMeta(row[metadataColumn]);
        if (meta[filter.key] === filter.value) {
          return toStoredFile(row, String(row[groupIdColumn]));
        }
      }
      return null;
    },
  };
}
