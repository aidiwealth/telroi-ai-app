// GET /api/admin/support/members -> people on the support desk.
//
// The client endpoint reads the caller's own tenant, which for an admin is their
// workspace or none — so the support teams page had nobody to offer when adding
// someone to a department.
import { eq } from 'drizzle-orm';
import { requirePlatformAdmin } from '~/server/utils/platform';
import { ensureSupportWorkspace } from '~/server/utils/support';
import { useDb, schema } from '~/server/db';

export default defineEventHandler(async (event) => {
  await requirePlatformAdmin(event);
  const ws = await ensureSupportWorkspace();
  const rows = await useDb().select({
    userId: schema.users.id,
    name: schema.users.name,
    email: schema.users.email,
    role: schema.memberships.role,
    pbxLogin: schema.memberships.pbxLogin,
    joinedAt: schema.memberships.createdAt
  }).from(schema.memberships)
    .innerJoin(schema.users, eq(schema.memberships.userId, schema.users.id))
    .where(eq(schema.memberships.tenantId, ws.tenantId));
  return { members: rows };
});
