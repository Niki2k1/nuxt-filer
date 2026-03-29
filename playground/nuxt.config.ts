export default defineNuxtConfig({
  modules: ['../src/module'],
  filer: {
    storageName: 'documents',
    storagePath: '.data/documents',
    provider: 'unstorage',
  },
  devtools: { enabled: true },
});
