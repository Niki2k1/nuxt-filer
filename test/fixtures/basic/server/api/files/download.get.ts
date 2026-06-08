export default defineEventHandler((event) => {
  const { groupId, id, disposition } = getQuery(event)
  return sendStoredFile(event, groupId as string, id as string, {
    disposition: disposition as 'inline' | 'attachment' | undefined,
  })
})
