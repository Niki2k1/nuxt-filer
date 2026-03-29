export default defineEventHandler(async (event) => {
  const { groupId, key, value } = getQuery(event)
  const storage = useFileStorage()
  const exists = await storage.checkDuplicate(groupId as string, key as string, value)

  return { exists }
})
