// GET /api/voice/escalation-targets -> people (SIP endpoints) a call can be
// escalated to from an AI agent. Returns { id, label } for a picker; the id is
// a sip_endpoints.id that the control-app resolves to a device to bridge to.
import { eq, and, isNotNull } from 'drizzle-orm';
import { requireTenant } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';

export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  const rows = await useDb().select({
    id: schema.sipEndpoints.id,
    label: schema.sipEndpoints.label,
    sipUsername: schema.sipEndpoints.sipUsername
  }).from(schema.sipEndpoints)
    .where(and(eq(schema.sipEndpoints.tenantId, s.tenantId), isNotNull(schema.sipEndpoints.sipUsername)));
  const targets = rows
    .filter((r) => r.sipUsername)
    .map((r) => ({ id: r.id, label: r.label || r.sipUsername || 'Agent' }));
  return { targets };
});
