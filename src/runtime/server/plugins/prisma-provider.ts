import { defineNitroPlugin } from 'nitropack/runtime';
// prettier-ignore
// @ts-expect-error virtual module
import { storageName, prismaModel, prismaGroupIdColumn, prismaMetadataColumn, prismaFindByMeta } from '#nuxt-filer-options';
// @ts-expect-error virtual module
import { client } from '#nuxt-filer-prisma';
import { createPrismaProvider } from '../providers/prisma';
import type { PrismaFileDelegate } from '../providers/prisma';
import { setFileStorageProvider } from '../provider';

export default defineNitroPlugin(() => {
  const delegate = (client as Record<string, PrismaFileDelegate>)[prismaModel];
  if (!delegate) {
    throw new Error(
      `nuxt-filer: Prisma model '${prismaModel}' not found on the configured client (filer.prisma.clientPath). Check filer.prisma.model.`
    );
  }

  setFileStorageProvider(
    createPrismaProvider(delegate, {
      storageName,
      groupIdColumn: prismaGroupIdColumn,
      metadataColumn: prismaMetadataColumn,
      findByMeta: prismaFindByMeta,
    })
  );
});
