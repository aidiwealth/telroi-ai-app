// GET /api/webhook-endpoints -> where this workspace wants to be told about
// its own traffic, and how recent deliveries went.
import { eq, desc } from 'drizzle-orm';
import { requireTenant } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';

export const EVENT_TYPES = [
  { id: 'call.completed', label: 'Call completed', note: 'Once a call reaches a final state' },
  { id: 'otp.completed', label: 'OTP delivered', note: 'When a verification call is placed' },
  { id: 'otp.failed', label: 'OTP failed', note: 'When one could not be placed' },
  { id: 'otp.verified', label: 'OTP verified', note: 'When somebody enters a code' }
];

export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  const db = useDb();

  const eps = await db.select().from(schema.webhookEndpoints)
    .where(eq(schema.webhookEndpoints.tenantId, s.tenantId))
    .orderBy(desc(schema.webhookEndpoints.createdAt));

  // Recent attempts, newest first. Older than thirty days is pruned, so this is
  // the whole history there is.
  const deliveries = await db.select().from(schema.webhookDeliveries)
    .where(eq(schema.webhookDeliveries.tenantId, s.tenantId))
    .orderBy(desc(schema.webhookDeliveries.createdAt)).limit(50);

  return {
    endpoints: eps.map((e) => ({
      id: e.id, url: e.url, events: e.events, enabled: e.enabled,
      disabledReason: e.disabledReason, hasSecret: !!e.secretEnc,
      consecutiveFailures: e.consecutiveFailures, createdAt: e.createdAt
    })),
    deliveries: deliveries.map((d) => ({
      id: d.id, eventType: d.eventType, status: d.status, attempts: d.attempts,
      responseStatus: d.responseStatus, responseExcerpt: d.responseExcerpt,
      createdAt: d.createdAt, deliveredAt: d.deliveredAt
    })),
    eventTypes: EVENT_TYPES
  };
});
