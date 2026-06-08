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
- **Upload-time image processing** — optionally run images through Sharp when storing them (resize, format-convert, optimize, preserve animation) via a per-call `transform` option or the standalone `transformImage()` util

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

### Upload-time image processing

Pass a `transform` option to `upload()` to process an image **before it is stored** — useful for normalizing user uploads or rehosted remote images to a capped size and compact format. The processed bytes are what gets stored, and the file's `meta.mime` / `meta.width` / `meta.height` are updated to match the result.

```ts
const id = await storage.upload(groupId, file.data, {
  meta: { name: file.filename!, mime: file.type!, type: 'image', version: 1 },
  transform: {
    width: 128,
    height: 128,
    format: 'webp', // convert to webp
    // fit: 'inside' (default), withoutEnlargement: true (default),
    // quality, background, animated (default true)
  },
})
```

You can also call the util directly (e.g. for images fetched server-side):

```ts
const res = await transformImage(buffer, { width: 64, format: 'webp' })
// res: { data: Buffer, mime: 'image/webp', format: 'webp', width: 64, height: 64 }
```

**`transform` / `transformImage()` options**

| Option | Description |
|---|---|
| `width`, `height` | Target box in px (combined with `fit`) |
| `fit` | Resize fit mode (`inside` default, or `cover`/`contain`/`fill`/`outside`) |
| `withoutEnlargement` | Never scale up beyond the original (default `true`) |
| `format` | Output format: `webp` / `png` / `jpeg` / `avif` / `gif` (default: keep input) |
| `quality` | Output quality `1-100` for lossy formats |
| `animated` | Preserve all frames of animated inputs (default `true`; only retained when `format` is `webp`/`gif`) |
| `background` | Background used when flattening transparency |

> Image processing requires the optional [`sharp`](https://sharp.pixelplumbing.com/) peer dependency. Install it (`npm i sharp`) only if you use `transform` / `transformImage()` — calling them without `sharp` throws a clear error. Without a `transform`, `upload()` stores the raw bytes unchanged and needs no extra dependency.

### `useFileStorage()` API

| Method | Description |
|---|---|
| `upload(groupId, data, options?)` | Store a file, returns its ID. `options.transform` runs the bytes through Sharp first (see above) |
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

## Prisma provider

The built-in `prisma` provider stores file **metadata in your database** (via your own Prisma client) and **binary data in the fs storage mount** (the same `storageName`/`storagePath` machinery the `unstorage` provider uses). The module wires the Nitro plugin for you — you only point it at your client and model.

Add a model to your Prisma schema. The generic shape:

```prisma
model FilerFile {
  id        String   @id @default(uuid())
  groupId   String
  metadata  Json?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([groupId])
}
```

Then configure the provider:

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ['nuxt-filer'],
  filer: {
    provider: 'prisma',
    prisma: {
      // Module exporting your Prisma client, resolvable from the Nitro server.
      clientPath: '~~/server/utils/prisma',
      // Export holding the client. Default: 'prisma' (use 'default' for a default export).
      clientExport: 'prisma',
      // Prisma model delegate name on the client.
      model: 'filerFile',
    },
  },
})
```

The column names are configurable, so the provider adapts to an existing schema rather than forcing one. For example, a table that keys files by `serviceorderId` and names its JSON column `metadata` on a model called `files`:

```ts
filer: {
  provider: 'prisma',
  prisma: {
    clientPath: '~~/server/utils/prisma',
    model: 'files',
    groupIdColumn: 'serviceorderId',   // default: 'groupId'
    metadataColumn: 'metadata',        // default: 'metadata'
    findByMeta: 'postgres-jsonpath',   // default: 'scan' (portable); Postgres-only opt-in
  },
}
```

`findByMeta` controls how metadata lookups run: `'scan'` (default) fetches rows by group and filters in JS — portable across every database Prisma supports; `'postgres-jsonpath'` pushes the filter into a JSON-path query for efficiency, but only works on Postgres.

`@prisma/client` is declared as an optional peer dependency — install it (and generate your client) only if you use this provider.

If you need behaviour the built-in provider doesn't cover (FK cascades, upload hooks, external blob storage), use a [custom provider](#custom-provider) instead — `createPrismaProvider` is also exported and auto-imported, so you can build on it.

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
