export default defineEventHandler(async (event) => {
  const groupId = getRouterParam(event, 'groupId')!;
  const storage = useFileStorage();

  const files = await storage.list(groupId);

  return files.map((f) => ({
    id: f.id,
    groupId: f.groupId,
    meta: f.meta,
    createdAt: f.createdAt,
    updatedAt: f.updatedAt,
  }));
});
