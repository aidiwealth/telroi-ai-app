// GET /api/admin/support/escalation-targets -> people a support AI call can be
// escalated to. The client endpoint reads whatever tenant session exists, which
// for an admin is their own workspace or none at all — so the support VAN editor
// asked the wrong place, got a 401, and showed no team members however many were
// connected.
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
    sipUsername: schema.sipEndpoints.sipUsername
  }).from(schema.sipEndpoints)
    .where(and(eq(schema.sipEndpoints.tenantId, ws.tenantId), isNotNull(schema.sipEndpoints.sipUsername)));
  const targets = rows
    .filter((r) => r.sipUsername)
    // Guest endpoints are leased to website visitors, not people who answer calls.
    .filter((r) => !String(r.label || '').startsWith('widget-guest'))
    .map((r) => ({ id: r.id, label: r.label || r.sipUsername || 'Agent' }));
  return { targets };
});
