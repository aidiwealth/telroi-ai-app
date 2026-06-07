// PATCH /api/admin/team/:id { role } -> change an operator's role. Superadmin only.
// Guards against demoting the last superadmin (which would lock out management).
import { z } from 'zod';
import { eq, and, ne } from 'drizzle-orm';
import { requirePlatformAdmin } from '~/server/utils/platform';
import { apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
import { logEvent } from '~/server/utils/logs';

const Body = z.object({ role: z.enum(['superadmin', 'staff']) });

export default defineEventHandler(async (event) => {
  const admin = await requirePlatformAdmin(event);
  if (admin.role !== 'superadmin') throw apiError('forbidden', 'Superadmin required', 403);
  const id = getRouterParam(event, 'id')!;
  const p = Body.safeParse(await readBody(event));
  if (!p.success) throw apiError('invalid', 'A valid role is required');
  const db = useDb();

  const [target] = await db.select().from(schema.platformAdmins).where(eq(schema.platformAdmins.id, id)).limit(1);
  if (!target) throw apiError('not_found', 'Operator not found', 404);

  // Don't allow demoting the last remaining superadmin.
  if (target.role === 'superadmin' && p.data.role !== 'superadmin') {
    const others = await db.select().from(schema.platformAdmins)
      .where(and(eq(schema.platformAdmins.role, 'superadmin'), ne(schema.platformAdmins.id, id)));
    if (others.length === 0) throw apiError('last_superadmin', 'You can’t demote the last superadmin.', 400);
  }

  await db.update(schema.platformAdmins).set({ role: p.data.role }).where(eq(schema.platformAdmins.id, id));
  await logEvent({ kind: 'system', action: 'team.role', summary: `${admin.email} set ${target.email} -> ${p.data.role}` });
  return { ok: true };
});
