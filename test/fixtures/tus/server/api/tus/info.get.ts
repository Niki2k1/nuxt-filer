export default defineEventHandler(async (event) => {
  const { tusId } = getQuery(event)
  const upload = await useTusStaging().info(tusId as string)

  if (!upload) return { exists: false }
  return {
    exists: true,
    id: upload.id,
    offset: upload.offset,
    size: upload.size,
    metadata: upload.metadata,
  }
})
