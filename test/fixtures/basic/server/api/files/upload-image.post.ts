export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const storage = useFileStorage()

  // `content` is a base64-encoded image; `transform` is forwarded verbatim.
  const id = await storage.upload(body.groupId, Buffer.from(body.content, 'base64'), {
    meta: body.meta,
    transform: body.transform,
  })

  const meta = await storage.getMeta(id)

  return { id, groupId: body.groupId, meta }
})
