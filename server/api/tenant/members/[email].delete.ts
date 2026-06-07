// DELETE /api/tenant/members/:email -> remove a member from the workspace.
// Owners/admins only. The owner cannot be removed; you can't remove yourself.
import { and, eq } from 'drizzle-orm';
import { requireTenant, apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
import { logEvent } from '~/server/utils/logs';

export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  if (s.role !== 'owner' && s.role !== 'admin') throw apiError('forbidden', 'Only owners and admins can remove members', 403);
  const email = decodeURIComponent(getRouterParam(event, 'email')!).toLowerCase();
  if (email === s.email.toLowerCase()) throw apiError('invalid', "You can't remove yourself");
  const db = useDb();

  const [user] = await db.select().from(schema.users).where(eq(schema.users.email, email)).limit(1);
  if (!user) throw apiError('not_found', 'Member not found', 404);
  const [m] = await db.select().from(schema.memberships)
    .where(and(eq(schema.memberships.userId, user.id), eq(schema.memberships.tenantId, s.tenantId))).limit(1);
  if (!m) throw apiError('not_found', 'Member not found', 404);
  if (m.role === 'owner') throw apiError('forbidden', "The workspace owner can't be removed", 403);

  await db.delete(schema.memberships)
    .where(and(eq(schema.memberships.userId, user.id), eq(schema.memberships.tenantId, s.tenantId)));
  await logEvent({ tenantId: s.tenantId, kind: 'system', action: 'member.removed', summary: `Removed ${email}` });
  return { ok: true };
});
