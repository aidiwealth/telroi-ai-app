// GET /api/admin/support/members -> operators who can take a support call.
//
// Read from sip_endpoints rather than memberships: a support operator is given an
// endpoint with their user id in its meta and never gets a memberships row, so
// querying memberships returned nobody however many operators were connected.
// Widget guest slots are excluded — they aren't people.
import { eq, and, isNotNull } from 'drizzle-orm';
import { requirePlatformAdmin } from '~/server/utils/platform';
import { ensureSupportWorkspace } from '~/server/utils/support';
import { useDb, schema } from '~/server/db';

export default defineEventHandler(async (event) => {
  await requirePlatformAdmin(event);
  const ws = await ensureSupportWorkspace();
  const rows = await useDb().select({
    id: schema.sipEndpoints.id,
    label: schema.sipEndpoints.label,
    sipUsername: schema.sipEndpoints.sipUsername,
    meta: schema.sipEndpoints.meta
  }).from(schema.sipEndpoints)
    .where(and(eq(schema.sipEndpoints.tenantId, ws.tenantId), isNotNull(schema.sipEndpoints.sipUsername)));

  const members = rows
    .filter((r) => (r.meta as any)?.userId && !/^widget-guest/i.test(r.label || ''))
    .map((r) => ({
      userId: (r.meta as any).userId as string,
      name: r.label || r.sipUsername,
      email: null,
      sipUsername: r.sipUsername
    }));

  return { members };
});
