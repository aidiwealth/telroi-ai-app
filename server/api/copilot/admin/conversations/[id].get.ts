import { requireSuperAdmin } from '~/server/utils/platform';
export default defineEventHandler(async (event) => {
  await requireSuperAdmin(event);
  return { id: getRouterParam(event, 'id'), messages: [] };
});
