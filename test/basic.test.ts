import { fileURLToPath } from 'node:url'
import { rm } from 'node:fs/promises'
import { describe, it, expect } from 'vitest'
import { setup, $fetch } from '@nuxt/test-utils/e2e'

const fixtureRoot = fileURLToPath(new URL('./fixtures/basic', import.meta.url))

// Wipe persisted storage so tests start from a clean slate.
await rm(fileURLToPath(new URL('../.data/test-documents', import.meta.url)), { recursive: true, force: true })

describe('nuxt-filer', async () => {
  await setup({
    rootDir: fixtureRoot,
  })

  it('renders the index page', async () => {
    const html = await $fetch('/')
    expect(html).toContain('<div>basic</div>')
  })

  it('uploads a file and returns an id', async () => {
    const result = await $fetch('/api/files/upload', {
      method: 'POST',
      body: {
        groupId: 'test-group',
        content: 'hello world',
        meta: { name: 'test.txt', mime: 'text/plain', type: 'document', version: 1 },
      },
    })

    expect(result.id).toBeDefined()
    expect(result.groupId).toBe('test-group')
  })

  it('lists files in a group', async () => {
    const files = await $fetch('/api/files/list?groupId=test-group')

    expect(files.length).toBeGreaterThanOrEqual(1)
    expect(files[0].meta.name).toBe('test.txt')
    expect(files[0].meta.mime).toBe('text/plain')
    expect(files[0].groupId).toBe('test-group')
  })

  it('gets a file with data', async () => {
    const uploaded = await $fetch('/api/files/upload', {
      method: 'POST',
      body: {
        groupId: 'get-test-group',
        content: 'hello world',
        meta: { name: 'get.txt', mime: 'text/plain', type: 'document', version: 1 },
      },
    })

    const file = await $fetch(`/api/files/get?groupId=get-test-group&id=${uploaded.id}`)

    expect(file.id).toBe(uploaded.id)
    expect(file.data).toBe('hello world')
    expect(file.meta.name).toBe('get.txt')
  })

  it('updates file metadata', async () => {
    const files = await $fetch('/api/files/list?groupId=test-group')
    const fileId = files[0].id

    await $fetch('/api/files/update-meta', {
      method: 'POST',
      body: { id: fileId, meta: { comment: 'updated comment' } },
    })

    const file = await $fetch(`/api/files/get?groupId=test-group&id=${fileId}`)
    expect(file.meta.comment).toBe('updated comment')
    // original fields preserved via defu merge
    expect(file.meta.name).toBe('test.txt')
  })

  it('checks for duplicates', async () => {
    const result = await $fetch('/api/files/check-duplicate?groupId=test-group&key=name&value=test.txt')
    expect(result.exists).toBe(true)

    const noResult = await $fetch('/api/files/check-duplicate?groupId=test-group&key=name&value=nonexistent.txt')
    expect(noResult.exists).toBe(false)
  })

  it('handles versioning - getLatestVersions', async () => {
    // Upload a v2 of the same file name
    await $fetch('/api/files/upload', {
      method: 'POST',
      body: {
        groupId: 'test-group',
        content: 'hello world v2',
        meta: { name: 'test.txt', mime: 'text/plain', type: 'document', version: 2 },
      },
    })

    const latest = await $fetch('/api/files/latest-versions?groupId=test-group')

    const testFile = latest.find((f: { meta: { name: string } }) => f.meta.name === 'test.txt')
    expect(testFile).toBeDefined()
    expect(testFile.meta.version).toBe(2)
  })

  it('uploads to different groups independently', async () => {
    await $fetch('/api/files/upload', {
      method: 'POST',
      body: {
        groupId: 'other-group',
        content: 'other content',
        meta: { name: 'other.pdf', mime: 'application/pdf', type: 'report', version: 1 },
      },
    })

    const otherFiles = await $fetch('/api/files/list?groupId=other-group')
    expect(otherFiles.length).toBe(1)
    expect(otherFiles[0].meta.name).toBe('other.pdf')

    // Original group still has its files
    const testFiles = await $fetch('/api/files/list?groupId=test-group')
    expect(testFiles.length).toBeGreaterThanOrEqual(2)
  })

  it('removes a file', async () => {
    const files = await $fetch('/api/files/list?groupId=other-group')
    const fileId = files[0].id

    await $fetch('/api/files/remove', {
      method: 'POST',
      body: { groupId: 'other-group', id: fileId },
    })

    const remaining = await $fetch('/api/files/list?groupId=other-group')
    expect(remaining.length).toBe(0)
  })

  it('returns empty list for unknown group', async () => {
    const files = await $fetch('/api/files/list?groupId=nonexistent')
    expect(files).toEqual([])
  })

  // Regression: the previous default driver (unstorage's fs-lite) sometimes
  // failed first-time writes to a brand-new key path with ENOENT because its
  // userspace `ensuredir` recursion is not as reliable as the kernel's
  // recursive mkdir. Group IDs with `:` map to nested directories.
  it('first-time upload to a brand-new nested group succeeds', async () => {
    const uniqueGroup = `project:first-${Date.now()}`
    const result = await $fetch('/api/files/upload', {
      method: 'POST',
      body: {
        groupId: uniqueGroup,
        content: 'first',
        meta: { name: 'a.txt', mime: 'text/plain', type: 'document', version: 1 },
      },
    })
    expect(result.id).toBeDefined()

    const files = await $fetch(`/api/files/list?groupId=${encodeURIComponent(uniqueGroup)}`)
    expect(files.length).toBe(1)
    expect(files[0].meta.name).toBe('a.txt')
  })
})
