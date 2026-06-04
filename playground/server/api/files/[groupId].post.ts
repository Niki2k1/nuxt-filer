export default defineEventHandler(async (event) => {
  const groupId = getRouterParam(event, 'groupId')!;
  const body = await readMultipartFormData(event);

  if (!body || body.length === 0) {
    throw createError({ statusCode: 400, message: 'No file provided' });
  }

  const file = body[0]!;
  const storage = useFileStorage();

  // Opt-in upload-time image processing (`?process=1`): cap to 128px and
  // convert to webp via the optional `sharp` peer dependency. `upload()`
  // rewrites the stored mime/dimensions to match the processed output.
  const isImage = (file.type || '').startsWith('image/');
  const process = getQuery(event).process === '1' && isImage;

  const id = await storage.upload(groupId, file.data, {
    meta: {
      name: file.filename || 'unnamed',
      mime: file.type || 'application/octet-stream',
      type: isImage ? 'image' : 'document',
      version: 1,
    },
    transform: process ? { width: 128, height: 128, format: 'webp' } : undefined,
  });

  return { id, groupId };
});
