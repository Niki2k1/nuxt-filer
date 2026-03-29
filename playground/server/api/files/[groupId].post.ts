export default defineEventHandler(async (event) => {
  const groupId = getRouterParam(event, 'groupId')!;
  const body = await readMultipartFormData(event);

  if (!body || body.length === 0) {
    throw createError({ statusCode: 400, message: 'No file provided' });
  }

  const file = body[0]!;
  const storage = useFileStorage();

  const id = await storage.upload(groupId, file.data, {
    meta: {
      name: file.filename || 'unnamed',
      mime: file.type || 'application/octet-stream',
      type: 'document',
      version: 1,
    },
  });

  return { id, groupId };
});
