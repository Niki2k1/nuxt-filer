import { defineNitroPlugin } from 'nitropack/runtime';
// prettier-ignore
// @ts-expect-error virtual module
import { storageName, drizzleIdColumn, drizzleGroupIdColumn, drizzleMetadataColumn, drizzleCreatedAtColumn, drizzleUpdatedAtColumn, drizzleFindByMeta } from '#nuxt-filer-options';
// @ts-expect-error virtual module
import { db, table, eq, and, sql } from '#nuxt-filer-drizzle';
import { createDrizzleProvider } from '../providers/drizzle';
import { setFileStorageProvider } from '../provider';

export default defineNitroPlugin(() => {
  if (!db || !table) {
    throw new Error(
      'nuxt-filer: the Drizzle `db` or `table` export could not be resolved (check filer.drizzle.clientPath / tablePath / table).'
    );
  }

  setFileStorageProvider(
    createDrizzleProvider({
      storageName,
      db,
      table,
      operators: { eq, and, sql },
      idColumn: drizzleIdColumn,
      groupIdColumn: drizzleGroupIdColumn,
      metadataColumn: drizzleMetadataColumn,
      createdAtColumn: drizzleCreatedAtColumn,
      updatedAtColumn: drizzleUpdatedAtColumn,
      findByMeta: drizzleFindByMeta,
    })
  );
});
