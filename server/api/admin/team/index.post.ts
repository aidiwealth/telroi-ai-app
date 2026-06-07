// POST /api/admin/team { email, role } -> add a platform admin (operator team
// member). Superadmin only. They sign in via the normal operator login once added.
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { requirePlatformAdmin } from '~/server/utils/platform';
import { apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
import { logEvent } from '~/server/utils/logs';

const Body = z.object({
  email: z.string().email(),
  role: z.enum(['superadmin', 'staff']).default('staff')
});

export default defineEventHandler(async (event) => {
  const admin = await requirePlatformAdmin(event);
  if (admin.role !== 'superadmin') throw apiError('forbidden', 'Superadmin required to manage the team', 403);
  const p = Body.safeParse(await readBody(event));
  if (!p.success) throw apiError('invalid', 'A valid email and role are required');
  const email = p.data.email.toLowerCase().trim();
  const db = useDb();

  const [existing] = await db.select().from(schema.platformAdmins).where(eq(schema.platformAdmins.email, email)).limit(1);
  if (existing) throw apiError('exists', 'That email is already on the operator team');

  const [row] = await db.insert(schema.platformAdmins).values({ email, role: p.data.role }).returning();
  await logEvent({ kind: 'system', action: 'team.add', summary: `${admin.email} added operator ${email} (${p.data.role})` });
  return { ok: true, admin: { id: row.id, email: row.email, role: row.role, createdAt: row.createdAt } };
});
