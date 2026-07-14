import { requireSuperAdmin } from '~/server/utils/platform';
export default defineEventHandler(async (event) => {
  await requireSuperAdmin(event);
  const body = await readBody(event);
  return { id: body?.id || 'admin-ephemeral' };
});
