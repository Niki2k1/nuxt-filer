export default defineEventHandler(async (event) => {
  const { groupId, id } = getQuery(event)
  const storage = useFileStorage()
  const file = await storage.get(groupId as string, id as string)

  if (!file) {
    throw createError({ statusCode: 404, statusMessage: 'File not found' })
  }

  return {
    id: file.id,
    groupId: file.groupId,
    meta: file.meta,
    data: file.data?.toString('utf-8'),
  }
})
