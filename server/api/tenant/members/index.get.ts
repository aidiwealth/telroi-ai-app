// GET /api/tenant/members -> workspace members (email + role + joined date).
import { eq } from 'drizzle-orm';
import { requireTenant } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  const db = useDb();
  const rows = await db.select({
    userId: schema.users.id,
    name: schema.users.name,
    email: schema.users.email,
    role: schema.memberships.role,
    pbxLogin: schema.memberships.pbxLogin,
    joinedAt: schema.memberships.createdAt
  }).from(schema.memberships)
    .innerJoin(schema.users, eq(schema.memberships.userId, schema.users.id))
    .where(eq(schema.memberships.tenantId, s.tenantId));
  return { members: rows, you: s.email, yourRole: s.role };
});
