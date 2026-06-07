// PATCH /api/tenant/members/:email { role } -> change a member's role.
// Owners/admins only. The owner role cannot be reassigned here, and you can't
// demote the last owner.
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { requireTenant, apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
import { logEvent } from '~/server/utils/logs';

const Body = z.object({ role: z.enum(['admin', 'member']) });

export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  if (s.role !== 'owner' && s.role !== 'admin') throw apiError('forbidden', 'Only owners and admins can change roles', 403);
  const email = decodeURIComponent(getRouterParam(event, 'email')!).toLowerCase();
  const p = Body.safeParse(await readBody(event));
  if (!p.success) throw apiError('invalid', 'A role is required');
  const db = useDb();

  const [user] = await db.select().from(schema.users).where(eq(schema.users.email, email)).limit(1);
  if (!user) throw apiError('not_found', 'Member not found', 404);
  const [m] = await db.select().from(schema.memberships)
    .where(and(eq(schema.memberships.userId, user.id), eq(schema.memberships.tenantId, s.tenantId))).limit(1);
  if (!m) throw apiError('not_found', 'Member not found', 404);
  if (m.role === 'owner') throw apiError('forbidden', "The owner's role can't be changed here", 403);

  await db.update(schema.memberships).set({ role: p.data.role })
    .where(and(eq(schema.memberships.userId, user.id), eq(schema.memberships.tenantId, s.tenantId)));
  await logEvent({ tenantId: s.tenantId, kind: 'system', action: 'member.role_changed', summary: `${email} -> ${p.data.role}` });
  return { ok: true };
});
