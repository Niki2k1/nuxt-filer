export default defineEventHandler(async (event) => {
  const body = await readBody(event);
  return await useTusStaging().promote(body.tusId, body.groupId);
});
