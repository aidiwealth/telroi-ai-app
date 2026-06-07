// DELETE /api/admin/team/:id -> remove an operator. Superadmin only.
// Guards: can't remove yourself, can't remove the last superadmin.
import { eq, and, ne } from 'drizzle-orm';
import { requirePlatformAdmin } from '~/server/utils/platform';
import { apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
import { logEvent } from '~/server/utils/logs';

export default defineEventHandler(async (event) => {
  const admin = await requirePlatformAdmin(event);
  if (admin.role !== 'superadmin') throw apiError('forbidden', 'Superadmin required', 403);
  const id = getRouterParam(event, 'id')!;
  const db = useDb();

  const [target] = await db.select().from(schema.platformAdmins).where(eq(schema.platformAdmins.id, id)).limit(1);
  if (!target) throw apiError('not_found', 'Operator not found', 404);
  if (target.email === admin.email) throw apiError('self', 'You can’t remove your own access.', 400);

  if (target.role === 'superadmin') {
    const others = await db.select().from(schema.platformAdmins)
      .where(and(eq(schema.platformAdmins.role, 'superadmin'), ne(schema.platformAdmins.id, id)));
    if (others.length === 0) throw apiError('last_superadmin', 'You can’t remove the last superadmin.', 400);
  }

  await db.delete(schema.platformAdmins).where(eq(schema.platformAdmins.id, id));
  await logEvent({ kind: 'system', action: 'team.remove', summary: `${admin.email} removed operator ${target.email}` });
  return { ok: true };
});
