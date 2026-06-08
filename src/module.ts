import {
  defineNuxtModule,
  createResolver,
  addServerImports,
  addImports,
  addServerHandler,
  hasNuxtModule,
  installModule,
} from '@nuxt/kit';
import { consola } from 'consola';

export interface FilerImageOptions {
  /**
   * Enable the @nuxt/image provider + IPX route. When `true` (the default),
   * the integration registers only if `@nuxt/image` is also installed; when
   * `false`, it is never registered. Set to `'force'` to register the routes
   * even when `@nuxt/image` cannot be detected (mainly useful for tests).
   */
  enabled?: boolean | 'force';
  /** Base path for the IPX endpoint. Default: `/_filer-ipx`. */
  route?: string;
  /** Name to register the @nuxt/image provider under. Default: `filer`. */
  providerName?: string;
}

/**
 * Configuration for the built-in `prisma` provider. Metadata is stored in a
 * database table via your Prisma client; binary data reuses the module's fs
 * storage mount (`storageName`/`storagePath`).
 */
export interface FilerPrismaOptions {
  /**
   * Path to a module exporting your Prisma client, resolvable from the Nitro
   * server (e.g. `'~~/server/utils/prisma'`).
   */
  clientPath: string;
  /**
   * Name of the export holding the client. Default: `'prisma'`. Use `'default'`
   * for a default export.
   */
  clientExport?: string;
  /** Prisma model delegate name on the client, e.g. `'filerFile'`. */
  model: string;
  /** Column holding the group id. Default: `'groupId'`. */
  groupIdColumn?: string;
  /** JSON column holding the file metadata. Default: `'metadata'`. */
  metadataColumn?: string;
  /**
   * findByMeta strategy. `'scan'` (default) is portable; `'postgres-jsonpath'`
   * pushes the filter into a JSON-path query (Postgres only).
   */
  findByMeta?: 'scan' | 'postgres-jsonpath';
}

export interface ModuleOptions {
  /** Nitro storage mount name for binary file data. Default: 'documents' */
  storageName?: string;
  /** Base path for the default fs-lite storage driver. Default: '.data/documents' */
  storagePath?: string;
  /** Provider mode. 'unstorage' uses the built-in unstorage provider. 'prisma' stores metadata in a database via your Prisma client (configure via `prisma`). 'custom' expects you to call setFileStorageProvider() in a Nitro plugin. Default: 'unstorage' */
  provider?: 'unstorage' | 'prisma' | 'custom';
  /** Configuration for the built-in `prisma` provider. Required when `provider` is `'prisma'`. */
  prisma?: FilerPrismaOptions;
  /** @nuxt/image integration. Set to `false` to disable, or pass an object to override defaults. */
  image?: boolean | FilerImageOptions;
}

export default defineNuxtModule<ModuleOptions>({
  meta: {
    name: 'nuxt-filer',
    configKey: 'filer',
  },
  defaults: {
    storageName: 'documents',
    storagePath: '.data/documents',
    provider: 'unstorage',
    image: true,
  },
  async setup(options, nuxt) {
    const resolver = createResolver(import.meta.url);

    // -------------------------------------------------------
    // Server auto-imports: useFileStorage composable
    // -------------------------------------------------------
    addServerImports([
      {
        name: 'useFileStorage',
        from: resolver.resolve('./runtime/server/utils/storage'),
      },
      {
        name: 'transformImage',
        from: resolver.resolve('./runtime/server/utils/image'),
      },
    ]);

    // -------------------------------------------------------
    // Server auto-imports: provider utilities
    // -------------------------------------------------------
    const providerSpecifier = resolver.resolve('./runtime/server/provider');
    addServerImports([
      { name: 'setFileStorageProvider', from: providerSpecifier },
      { name: 'useFileStorageProvider', from: providerSpecifier },
    ]);

    // -------------------------------------------------------
    // Server auto-imports: built-in unstorage provider factory
    // -------------------------------------------------------
    addServerImports([
      {
        name: 'createUnstorageProvider',
        from: resolver.resolve('./runtime/server/providers/unstorage'),
      },
      {
        name: 'createPrismaProvider',
        from: resolver.resolve('./runtime/server/providers/prisma'),
      },
    ]);

    // -------------------------------------------------------
    // Auto-imports: types (available everywhere)
    // -------------------------------------------------------
    const typesSpecifier = 'nuxt-filer/runtime/types';
    addImports([
      { name: 'FileMeta', from: typesSpecifier, type: true },
      { name: 'StoredFile', from: typesSpecifier, type: true },
      { name: 'ExternalRef', from: typesSpecifier, type: true },
      { name: 'FileStorageProvider', from: typesSpecifier, type: true },
      {
        name: 'FileStorageExternalProvider',
        from: typesSpecifier,
        type: true,
      },
      { name: 'ImageFormat', from: typesSpecifier, type: true },
      { name: 'ImageTransformOptions', from: typesSpecifier, type: true },
      { name: 'ImageTransformResult', from: typesSpecifier, type: true },
    ]);

    // -------------------------------------------------------
    // @nuxt/image integration
    // -------------------------------------------------------
    const imageOpt: FilerImageOptions =
      typeof options.image === 'object' && options.image !== null
        ? options.image
        : {};
    const imageEnabled =
      options.image !== false && (imageOpt.enabled ?? true) !== false;
    const ipxRoute = (imageOpt.route ?? '/_filer-ipx').replace(/\/+$/, '');
    const providerName = imageOpt.providerName ?? 'filer';

    const shouldRegisterImage =
      imageEnabled
      && (imageOpt.enabled === 'force' || hasNuxtModule('@nuxt/image'));

    if (shouldRegisterImage) {
      addServerHandler({
        route: `${ipxRoute}/**`,
        handler: resolver.resolve('./runtime/server/handlers/ipx'),
      });

      // Inject the provider into the user's image config. @nuxt/image
      // snapshots `options.providers` during its own setup, so if it has
      // already run (i.e. was listed before nuxt-filer in `modules`) we have
      // to re-install it so the snapshot includes us. When it has not run
      // yet, mutating the options is enough — its upcoming setup will see
      // the provider naturally.
      const imageConfig =
        ((nuxt.options as Record<string, unknown>).image as
          | { providers?: Record<string, unknown> }
          | undefined) ?? {};
      const providers = imageConfig.providers ?? {};
      providers[providerName] = {
        name: providerName,
        provider: resolver.resolve('./runtime/image/provider'),
        options: { baseURL: ipxRoute },
      };
      imageConfig.providers = providers;
      (nuxt.options as Record<string, unknown>).image = imageConfig;

      const imageAlreadyLoaded = (
        nuxt.options as { _installedModules?: Array<{ meta?: { name?: string } }> }
      )._installedModules?.some((m) => m.meta?.name === '@nuxt/image');
      if (imageAlreadyLoaded) {
        await installModule('@nuxt/image');
      }
    } else if (imageEnabled && options.image !== false) {
      consola.info(
        'nuxt-filer: @nuxt/image not detected — IPX integration disabled. Install `@nuxt/image` to enable optimized image variants.'
      );
    }

    // -------------------------------------------------------
    // Nitro configuration: virtual module + storage mount + provider plugin
    // -------------------------------------------------------
    if (options.provider === 'prisma' && !options.prisma?.clientPath) {
      throw new Error(
        "nuxt-filer: provider is 'prisma' but `filer.prisma.clientPath` is not set. Point it at the module that exports your Prisma client (e.g. '~~/server/utils/prisma')."
      );
    }
    if (options.provider === 'prisma' && !options.prisma?.model) {
      throw new Error(
        "nuxt-filer: provider is 'prisma' but `filer.prisma.model` is not set. Set it to your Prisma model delegate name (e.g. 'filerFile')."
      );
    }

    nuxt.hook('nitro:config', (nitroConfig) => {
      const prisma = options.prisma;
      nitroConfig.virtual = nitroConfig.virtual || {};
      nitroConfig.virtual['#nuxt-filer-options'] = [
        `export const storageName = ${JSON.stringify(options.storageName)};`,
        `export const storagePath = ${JSON.stringify(options.storagePath)};`,
        `export const prismaModel = ${JSON.stringify(prisma?.model)};`,
        `export const prismaGroupIdColumn = ${JSON.stringify(prisma?.groupIdColumn ?? 'groupId')};`,
        `export const prismaMetadataColumn = ${JSON.stringify(prisma?.metadataColumn ?? 'metadata')};`,
        `export const prismaFindByMeta = ${JSON.stringify(prisma?.findByMeta ?? 'scan')};`,
      ].join('\n');
      // Always emit the image virtual; the handler is only wired when enabled.
      nitroConfig.virtual['#nuxt-filer-image'] = `export const ipxRoute = ${JSON.stringify(ipxRoute)}`;

      // Auto-mount filesystem storage for the built-in providers. We mount via
      // a Nitro plugin that ships our own fs driver (rather than
      // `nitroConfig.storage` with `driver: 'fsLite'`) because unstorage's
      // fs-lite relies on a userspace `ensuredir` recursion that intermittently
      // fails with ENOENT on first writes to a new key path. Our driver uses
      // the kernel's atomic `mkdir(..., { recursive: true })`. The `prisma`
      // provider keeps binary data here too — only metadata goes to the DB.
      if (options.provider === 'unstorage' || options.provider === 'prisma') {
        nitroConfig.plugins = nitroConfig.plugins || [];
        nitroConfig.plugins.push(
          resolver.resolve('./runtime/server/plugins/default-storage')
        );
      }

      if (options.provider === 'unstorage') {
        nitroConfig.plugins = nitroConfig.plugins || [];
        nitroConfig.plugins.push(
          resolver.resolve('./runtime/server/plugins/default-provider')
        );
      }

      if (options.provider === 'prisma' && prisma) {
        // Re-export the user's Prisma client from a virtual so the provider
        // plugin can import it without a static path. Mirrors the other
        // `#nuxt-filer-*` virtuals.
        const clientExport = prisma.clientExport ?? 'prisma';
        nitroConfig.virtual['#nuxt-filer-prisma'] =
          clientExport === 'default'
            ? `import client from ${JSON.stringify(prisma.clientPath)};\nexport { client };`
            : `export { ${clientExport} as client } from ${JSON.stringify(prisma.clientPath)};`;

        nitroConfig.plugins = nitroConfig.plugins || [];
        nitroConfig.plugins.push(
          resolver.resolve('./runtime/server/plugins/prisma-provider')
        );
      }
    });

    consola.success('nuxt-filer ready');
  },
});
