export default defineEventHandler(async (event) => {
  const { groupId, id } = await readBody(event)
  const storage = useFileStorage()
  await storage.remove(groupId, id)

  return { success: true }
})
