import { defineNitroPlugin, useStorage } from 'nitropack/runtime';
// @ts-expect-error virtual module
import { storageName, storagePath } from '#nuxt-filer-options';
import fsDriver from '../drivers/fs';

/**
 * Mount the default filesystem-backed storage for nuxt-filer. We mount
 * via a Nitro plugin rather than `nitroConfig.storage` so that our
 * custom fs driver is bundled with the plugin and there is no runtime
 * module resolution against the package's `dist/`.
 */
export default defineNitroPlugin(() => {
  const storage = useStorage();
  storage.mount(storageName, fsDriver({ base: storagePath }));
});
