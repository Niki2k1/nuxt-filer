// @ts-expect-error virtual module
import { storageName } from '#nuxt-filer-options';
import { createUnstorageProvider } from '../providers/unstorage';
import { setFileStorageProvider } from '../provider';

export default defineNitroPlugin(() => {
  setFileStorageProvider(createUnstorageProvider(storageName));
});
