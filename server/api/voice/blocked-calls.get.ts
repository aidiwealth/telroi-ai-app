// GET /api/voice/blocked-calls -> recent inbound calls that were rejected by the
// blacklist or the anonymous-call block, so the Blacklist page can show what's
// actually being caught. Reads call_events (status='blacklisted').
import { requireTenant } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
import { and, eq, desc } from 'drizzle-orm';

export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  const rows = await useDb().select({
    callid: schema.callEvents.callid,
    phone: schema.callEvents.phone,
    startedAt: schema.callEvents.startedAt
  }).from(schema.callEvents)
    .where(and(eq(schema.callEvents.tenantId, s.tenantId), eq(schema.callEvents.status, 'blacklisted')))
    .orderBy(desc(schema.callEvents.startedAt))
    .limit(50);
  return {
    items: rows.map((r) => ({
      callid: r.callid,
      phone: r.phone && r.phone !== 'anonymous' ? r.phone : null,
      anonymous: !r.phone || r.phone === 'anonymous',
      at: r.startedAt?.toISOString?.() || null
    }))
  };
});
