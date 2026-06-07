// DELETE /api/admin/apps/:id -> remove an app release.
import { eq } from 'drizzle-orm';
import { requireSuperAdmin } from '~/server/utils/platform';
import { apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
export default defineEventHandler(async (event) => {
  await requireSuperAdmin(event);
  const id = getRouterParam(event, 'id');
  if (!id) throw apiError('invalid', 'id required');
  const db = useDb();
  await db.delete(schema.appReleases).where(eq(schema.appReleases.id, id));
  return { ok: true };
});
