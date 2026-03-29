export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const storage = useFileStorage()

  const id = await storage.upload(body.groupId, Buffer.from(body.content), {
    meta: body.meta,
  })

  return { id, groupId: body.groupId }
})
