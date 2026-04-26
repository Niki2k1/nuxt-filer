# nuxt-filer

[![npm version][npm-version-src]][npm-version-href]
[![npm downloads][npm-downloads-src]][npm-downloads-href]
[![License][license-src]][license-href]
[![Nuxt][nuxt-src]][nuxt-href]

File storage module for Nuxt. Provides a server-side `useFileStorage()` composable with pluggable storage backends — from zero-config local filesystem to custom providers with separate metadata databases and external file sync.

## Features

- **Pluggable provider architecture** — use the built-in unstorage provider or bring your own (Prisma, Drizzle, etc.)
- **File versioning** — built-in version tracking, latest-version filtering, and duplicate detection
- **External file sync** — two-way sync with external systems (Jira, SharePoint, etc.) via optional provider interface
- **Zero-config default** — works out of the box with local filesystem storage, no database required
- **Auto-imported** — `useFileStorage()`, types, and provider utilities are auto-imported in server context
- **Group-based organization** — files are organized by `groupId` (project, ticket, order, etc.)
- **`@nuxt/image` integration** — when `@nuxt/image` is installed, an IPX endpoint is wired up automatically so `<NuxtImg provider="filer" src="<groupId>/<id>" />` returns optimized variants of stored files

## Quick Setup

```bash
npx nuxi module add nuxt-filer
```

## Configuration

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ['nuxt-filer'],
  filer: {
    // Nitro storage mount name (default: 'documents')
    storageName: 'documents',
    // Base path for fs-lite driver (default: '.data/documents')
    storagePath: '.data/documents',
    // 'unstorage' (built-in) or 'custom' (bring your own provider)
    provider: 'unstorage',
  },
})
```

## Usage

### Basic — Upload and retrieve files

```ts
// server/api/files/[groupId].post.ts
export default defineEventHandler(async (event) => {
  const groupId = getRouterParam(event, 'groupId')!
  const body = await readMultipartFormData(event)
  const file = body![0]!

  const storage = useFileStorage()

  const id = await storage.upload(groupId, file.data, {
    meta: {
      name: file.filename || 'unnamed',
      mime: file.type || 'application/octet-stream',
      type: 'document',
      version: 1,
    },
  })

  return { id, groupId }
})
```

```ts
// server/api/files/[groupId].get.ts
export default defineEventHandler(async (event) => {
  const groupId = getRouterParam(event, 'groupId')!
  const storage = useFileStorage()

  return await storage.list(groupId)
})
```

### `useFileStorage()` API

| Method | Description |
|---|---|
| `upload(groupId, data, options?)` | Store a file, returns its ID |
| `list(groupId)` | List all files in a group |
| `get(groupId, id)` | Get a file with data and metadata |
| `getData(groupId, id)` | Get raw binary data only |
| `getMeta(id)` | Get metadata only |
| `updateMeta(id, meta)` | Deep-merge metadata update |
| `remove(groupId, id)` | Delete a file |
| `clear(groupId)` | Delete all files in a group |
| `has(groupId, id)` | Check if a file exists |
| `findByMeta(key, value, groupId?)` | Find a file by metadata field |
| `checkDuplicate(groupId, key, value)` | Check if a duplicate exists |
| `getLatestVersions(groupId)` | Get latest version of each file by name |
| `getNextVersionNumber(files, name)` | Calculate next version number |
| `external?.sync(groupId, id)` | Sync with external system (if provider supports it) |
| `external?.push(groupId, id, data, meta)` | Push to external system |
| `external?.pull(groupId, ref)` | Pull from external system |

## `@nuxt/image` Integration

If `@nuxt/image` is installed alongside `nuxt-filer`, the module automatically registers a `filer` image provider and an IPX endpoint that pulls bytes from your storage provider, runs them through Sharp, and returns the result.

```vue
<template>
  <NuxtImg
    provider="filer"
    :src="`${groupId}/${fileId}`"
    width="200"
    height="200"
    fit="cover"
    format="webp"
  />
</template>
```

Generated URLs look like `/_filer-ipx/w_200,h_200,fit_cover,format_webp/<groupId>/<fileId>` and are served with `cache-control: max-age=...`, `last-modified`, and `etag` for `if-modified-since` / `if-none-match` revalidation.

The integration can be configured or turned off:

```ts
filer: {
  image: {
    enabled: true,            // false to disable; 'force' to register without @nuxt/image
    route: '/_filer-ipx',     // base path for the IPX endpoint
    providerName: 'filer',    // name used in <NuxtImg provider="..." />
  },
},
```

`@nuxt/image` and `ipx` are declared as optional peer dependencies — they only need to be installed if you want to use this integration.

## Custom Provider

For advanced use cases (database-backed metadata, S3 storage, external file sync), implement the `FileStorageProvider` interface and register it in a Nitro plugin:

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ['nuxt-filer'],
  filer: {
    provider: 'custom',
  },
})
```

```ts
// server/plugins/file-provider.ts
export default defineNitroPlugin(() => {
  setFileStorageProvider({
    async create(groupId, data, meta) {
      // Store binary data (e.g. S3, unstorage)
      // Store metadata (e.g. Prisma, Drizzle)
      return { id: '...' }
    },
    async get(groupId, id) { /* ... */ },
    async getData(groupId, id) { /* ... */ },
    async getMeta(id) { /* ... */ },
    async list(groupId) { /* ... */ },
    async update(id, meta) { /* ... */ },
    async remove(groupId, id) { /* ... */ },
    async clear(groupId) { /* ... */ },
    async has(groupId, id) { /* ... */ },
    async findByMeta(filter) { /* ... */ },

    // Optional: external file sync
    external: {
      async sync(groupId, id) { /* ... */ },
      async push(groupId, id, data, meta) { /* ... */ },
      async pull(groupId, externalRef) { /* ... */ },
    },
  })
})
```

### Provider interface

```ts
interface FileStorageProvider {
  create(groupId: string, data: Buffer | Uint8Array, meta?: FileMeta): Promise<{ id: string }>
  get(groupId: string, id: string): Promise<StoredFile | null>
  getData(groupId: string, id: string): Promise<Buffer | null>
  getMeta(id: string): Promise<FileMeta | null>
  list(groupId: string): Promise<StoredFile[]>
  update(id: string, meta: Partial<FileMeta>): Promise<void>
  remove(groupId: string, id: string): Promise<void>
  clear(groupId: string): Promise<void>
  has(groupId: string, id: string): Promise<boolean>
  findByMeta(filter: { key: string; value: unknown; groupId?: string }): Promise<StoredFile | null>
  external?: FileStorageExternalProvider
}
```

### Types

```ts
interface FileMeta {
  name: string
  mime: string
  type: string
  version: number
  username?: string
  comment?: string
  [key: string]: unknown  // extend with your own fields
}

interface StoredFile {
  id: string
  groupId: string
  data?: Buffer
  meta: FileMeta
  external?: ExternalRef
  createdAt?: Date
  updatedAt?: Date
}

interface ExternalRef {
  source: string       // e.g. 'jira', 'sharepoint'
  externalId: string
  externalUrl?: string
  cachedAt?: Date
}
```

## Contribution

<details>
  <summary>Local development</summary>

  ```bash
  # Install dependencies
  pnpm install

  # Generate type stubs
  pnpm run dev:prepare

  # Develop with the playground
  pnpm run dev

  # Run ESLint
  pnpm run lint

  # Run Vitest
  pnpm run test

  # Release new version
  pnpm run release
  ```

</details>

## License

[MIT](./LICENSE)

<!-- Badges -->

[npm-version-src]: https://img.shields.io/npm/v/nuxt-filer/latest.svg?style=flat&colorA=020420&colorB=00DC82
[npm-version-href]: https://npmjs.com/package/nuxt-filer
[npm-downloads-src]: https://img.shields.io/npm/dm/nuxt-filer.svg?style=flat&colorA=020420&colorB=00DC82
[npm-downloads-href]: https://npm.chart.dev/nuxt-filer
[license-src]: https://img.shields.io/npm/l/nuxt-filer.svg?style=flat&colorA=020420&colorB=00DC82
[license-href]: https://npmjs.com/package/nuxt-filer
[nuxt-src]: https://img.shields.io/badge/Nuxt-020420?logo=nuxt.js
[nuxt-href]: https://nuxt.com
