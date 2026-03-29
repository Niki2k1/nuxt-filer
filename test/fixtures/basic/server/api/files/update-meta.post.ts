export default defineEventHandler(async (event) => {
  const { id, meta } = await readBody(event)
  const storage = useFileStorage()
  await storage.updateMeta(id, meta)

  return { success: true }
})
