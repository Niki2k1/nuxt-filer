export default defineEventHandler(async (event) => {
  const { groupId } = getQuery(event)
  const storage = useFileStorage()
  const files = await storage.getLatestVersions(groupId as string)

  return files.map((f) => ({
    id: f.id,
    groupId: f.groupId,
    meta: f.meta,
  }))
})
