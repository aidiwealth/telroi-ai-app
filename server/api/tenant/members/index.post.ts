// POST /api/tenant/members { email, role } -> invite a teammate to the workspace.
// Only owners/admins may invite. Creates the user if needed, adds a membership,
// and emails a sign-in link. Passwordless: they sign in and land in the workspace.
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { requireTenant, apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
import { startLogin } from '~/server/utils/auth-core';
import { logEvent } from '~/server/utils/logs';

const Body = z.object({ email: z.string().email(), role: z.enum(['admin', 'member']).default('member') });

export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  if (s.role !== 'owner' && s.role !== 'admin') throw apiError('forbidden', 'Only owners and admins can invite members', 403);
  const p = Body.safeParse(await readBody(event));
  if (!p.success) throw apiError('invalid', 'A valid email and role are required');
  const db = useDb();
  const email = p.data.email.trim().toLowerCase();

  // Find or create the user.
  let [user] = await db.select().from(schema.users).where(eq(schema.users.email, email)).limit(1);
  if (!user) [user] = await db.insert(schema.users).values({ email }).returning();

  // Already a member?
  const [existing] = await db.select().from(schema.memberships)
    .where(and(eq(schema.memberships.userId, user.id), eq(schema.memberships.tenantId, s.tenantId))).limit(1);
  if (existing) throw apiError('exists', 'That person is already a member of this workspace');

  await db.insert(schema.memberships).values({ userId: user.id, tenantId: s.tenantId, role: p.data.role });

  // An invite, not a bare sign-in link. The recipient may never have heard of
  // us: an unexpected login email for an account they didn't create reads like
  // a phishing attempt, and saying who invited them and to what is the whole
  // difference between that and something they'll act on.
  const [ws] = await db.select({ name: schema.tenants.name })
    .from(schema.tenants).where(eq(schema.tenants.id, s.tenantId)).limit(1);
  try {
    await startLogin(email, { workspace: ws?.name || 'a Telroi workspace', invitedBy: s.email });
  } catch { /* email failure shouldn't block the invite */ }

  await logEvent({ tenantId: s.tenantId, kind: 'system', action: 'member.invited', summary: `Invited ${email} as ${p.data.role}` });
  return { ok: true, member: { email, role: p.data.role } };
});
