export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const staging = useTusStaging()

  return await staging.promote(body.tusId, body.groupId, {
    meta: body.meta,
    removeStaged: body.removeStaged,
  })
})
