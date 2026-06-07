// POST /api/voice/agents -> create the PBX user (call extension) for a person,
// and store the explicit link (memberships.pbxLogin) so the People directory
// joins by a stored fact, not an email guess. Owner/admin only.
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { requireTenantManager, apiError } from '~/server/utils/api';
import { telroiFor } from '~/server/utils/tenant';
import { useDb, schema } from '~/server/db';

const Body = z.object({
  login: z.string().min(1).max(64),
  name: z.string().optional(),
  email: z.string().email().optional()
}).passthrough();

export default defineEventHandler(async (event) => {
  const s = await requireTenantManager(event);
  const p = Body.safeParse(await readBody(event));
  if (!p.success) throw apiError('invalid', 'A login is required');

  const client = await telroiFor(s.tenantId);
  // Create the real PBX user (extension).
  const created = await client.addUser(p.data);

  // Store the explicit link on the membership if we can resolve the person.
  if (p.data.email) {
    try {
      const db = useDb();
      const [u] = await db.select({ id: schema.users.id }).from(schema.users)
        .where(eq(schema.users.email, p.data.email)).limit(1);
      if (u) {
        await db.update(schema.memberships).set({ pbxLogin: p.data.login })
          .where(and(eq(schema.memberships.tenantId, s.tenantId), eq(schema.memberships.userId, u.id)));
      }
    } catch { /* link best-effort; extension still created */ }
  }
  return created;
});
