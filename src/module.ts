import {
  defineNuxtModule,
  createResolver,
  addServerImports,
  addImports,
} from '@nuxt/kit';
import { consola } from 'consola';

export interface ModuleOptions {
  /** Nitro storage mount name for binary file data. Default: 'documents' */
  storageName?: string;
  /** Base path for the default fs-lite storage driver. Default: '.data/documents' */
  storagePath?: string;
  /** Provider mode. 'unstorage' uses the built-in unstorage provider. 'custom' expects you to call setFileStorageProvider() in a Nitro plugin. Default: 'unstorage' */
  provider?: 'unstorage' | 'custom';
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
  },
  setup(options, nuxt) {
    const resolver = createResolver(import.meta.url);

    // -------------------------------------------------------
    // Server auto-imports: useFileStorage composable
    // -------------------------------------------------------
    addServerImports([
      {
        name: 'useFileStorage',
        from: resolver.resolve('./runtime/server/utils/storage'),
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
    ]);

    // -------------------------------------------------------
    // Nitro configuration: virtual module + storage mount + provider plugin
    // -------------------------------------------------------
    nuxt.hook('nitro:config', (nitroConfig) => {
      // Virtual module with resolved options
      nitroConfig.virtual = nitroConfig.virtual || {};
      nitroConfig.virtual['#nuxt-filer-options'] = `export const storageName = ${JSON.stringify(options.storageName)}`;

      // Auto-mount fs-lite storage when using the built-in unstorage provider
      if (options.provider === 'unstorage') {
        nitroConfig.storage = nitroConfig.storage || {};
        nitroConfig.storage[options.storageName!] = {
          driver: 'fsLite',
          base: options.storagePath,
        };

        // Register the default provider plugin
        nitroConfig.plugins = nitroConfig.plugins || [];
        nitroConfig.plugins.push(
          resolver.resolve('./runtime/server/plugins/default-provider')
        );
      }
    });

    consola.success('nuxt-filer ready');
  },
});
