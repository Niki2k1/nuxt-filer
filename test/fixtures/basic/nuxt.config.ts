import MyModule from '../../../src/module'

export default defineNuxtConfig({
  modules: [
    MyModule,
  ],
  filer: {
    storageName: 'documents',
    storagePath: '.data/test-documents',
    provider: 'unstorage',
  },
})
