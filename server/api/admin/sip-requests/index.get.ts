// GET /api/admin/sip-requests -> clients asking us to trust an address.
// Pending first: an address waiting is a client who cannot send traffic.
import { desc, eq } from 'drizzle-orm';
import { requirePlatformAdmin } from '~/server/utils/platform';
import { useDb, schema } from '~/server/db';

export default defineEventHandler(async (event) => {
  await requirePlatformAdmin(event);
  const db = useDb();
  const rows = await db.select({
    id: schema.sipIpRequests.id,
    ipAddress: schema.sipIpRequests.ipAddress,
    note: schema.sipIpRequests.note,
    status: schema.sipIpRequests.status,
    rejectReason: schema.sipIpRequests.rejectReason,
    requestedBy: schema.sipIpRequests.requestedBy,
    decidedBy: schema.sipIpRequests.decidedBy,
    decidedAt: schema.sipIpRequests.decidedAt,
    createdAt: schema.sipIpRequests.createdAt,
    tenantId: schema.sipIpRequests.tenantId,
    workspace: schema.tenants.name,
    slug: schema.tenants.slug
  }).from(schema.sipIpRequests)
    .innerJoin(schema.tenants, eq(schema.tenants.id, schema.sipIpRequests.tenantId))
    .orderBy(desc(schema.sipIpRequests.createdAt));

  return {
    pending: rows.filter((r) => r.status === 'pending'),
    decided: rows.filter((r) => r.status !== 'pending').slice(0, 50)
  };
});
