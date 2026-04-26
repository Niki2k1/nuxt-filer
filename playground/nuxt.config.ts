export default defineNuxtConfig({
  modules: ['../src/module', '@nuxt/image'],
  filer: {
    storageName: 'documents',
    storagePath: '.data/documents',
    provider: 'unstorage',
  },
  devtools: { enabled: true },
});
