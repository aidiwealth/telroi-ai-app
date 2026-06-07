// GET /api/admin/me -> platform-admin identity (or 403)
import { requirePlatformAdmin } from '~/server/utils/platform';
export default defineEventHandler(async (event) => {
  const admin = await requirePlatformAdmin(event);
  return { admin };
});
