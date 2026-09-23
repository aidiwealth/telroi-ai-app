// POST /api/admin/clients/:domain/impersonate
//
// Full access to a client account, for support. Not a shared password — a real
// session for the workspace owner, minted through the same issueSession every
// login uses, carrying the admin's email so it can never be mistaken for the
// client's own login and every use is recorded.
//
// Superadmin only. This is the most powerful action on the platform: it is
// standing inside someone else's account with their permissions.
import { requirePlatformAdmin } from '~/server/utils/platform';
import { apiError } from '~/server/utils/api';
import { resolveTenantByDomain } from '~/server/utils/resolve-tenant';
import { issueSession } from '~/server/utils/session';
import { useDb, schema } from '~/server/db';
import { and, eq } from 'drizzle-orm';
import { logEvent } from '~/server/utils/logs';

export default defineEventHandler(async (event) => {
  const admin = await requirePlatformAdmin(event);
  if (admin.role !== 'superadmin') throw apiError('forbidden', 'Superadmin required', 403);

  const domain = getRouterParam(event, 'domain') || '';
  const tenant = await resolveTenantByDomain(domain);
  if (!tenant) throw apiError('not_found', 'Workspace not found', 404);

  // Act as the owner, so support sees exactly what the client sees.
  const db = useDb();
  const [owner] = await db.select({ userId: schema.memberships.userId, email: schema.users.email, role: schema.memberships.role })
    .from(schema.memberships)
    .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
    .where(and(eq(schema.memberships.tenantId, tenant.id), eq(schema.memberships.role, 'owner')))
    .limit(1);
  if (!owner) throw apiError('no_owner', 'This workspace has no owner to act as.', 409);

  // Recorded before the session is issued, so the audit trail cannot be
  // sidestepped by the write failing after access is granted.
  await logEvent({
    tenantId: tenant.id, kind: 'system', action: 'admin.impersonate',
    summary: `${admin.email} logged in as ${tenant.name} (${owner.email})`,
    ref: `imp_${tenant.id}_${Date.now()}`
  });

  await issueSession(event, {
    userId: owner.userId, email: owner.email, tenantId: tenant.id, role: owner.role,
    impersonatedBy: admin.email
  });

  return { ok: true, tenant: { name: tenant.name, slug: tenant.slug } };
});
