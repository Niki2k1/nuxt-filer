import { defineEventHandler } from 'h3';
import { createIPX, createIPXH3Handler, type IPX, type IPXStorage } from 'ipx';
// @ts-expect-error virtual module injected by the module
import { ipxRoute } from '#nuxt-filer-image';
import { useFileStorageProvider } from '../provider';

/**
 * Maps an IPX `id` (the path after the modifiers segment) to a `(groupId, fileId)`
 * pair as used by the file storage provider. Ids are expected as
 * `groupId/fileId` — additional `/` characters in the group id are preserved.
 */
function parseId(id: string): [string, string] | null {
  const lastSlash = id.lastIndexOf('/');
  if (lastSlash <= 0 || lastSlash === id.length - 1) return null;
  return [id.slice(0, lastSlash), id.slice(lastSlash + 1)];
}

const filerStorage: IPXStorage = {
  name: 'nuxt-filer',
  async getMeta(id) {
    const parsed = parseId(id);
    if (!parsed) return undefined;
    const [groupId, fileId] = parsed;
    const provider = useFileStorageProvider();
    const file = await provider.get(groupId, fileId);
    if (!file) return undefined;
    const mtime = file.updatedAt ?? file.createdAt ?? new Date();
    return {
      mtime,
      maxAge: 60 * 60 * 24 * 365,
    };
  },
  async getData(id) {
    const parsed = parseId(id);
    if (!parsed) return undefined;
    const [groupId, fileId] = parsed;
    const data = await useFileStorageProvider().getData(groupId, fileId);
    if (!data) return undefined;
    // IPX accepts ArrayBuffer | Buffer; pass the buffer view directly.
    return data as unknown as ArrayBuffer;
  },
};

let _handler: ReturnType<typeof createIPXH3Handler> | null = null;
let _ipx: IPX | null = null;
function getHandler() {
  if (!_handler) {
    _ipx = createIPX({ storage: filerStorage });
    _handler = createIPXH3Handler(_ipx);
  }
  return _handler;
}

export default defineEventHandler((event) => {
  // Strip the configured base prefix so IPX sees the URL it expects:
  // `/<modifiers>/<groupId>/<fileId>`.
  const original = event.path;
  let sub = original.startsWith(ipxRoute)
    ? original.slice((ipxRoute as string).length)
    : original;
  if (!sub.startsWith('/')) sub = `/${sub}`;
  event.path = sub;
  return getHandler()(event);
});
