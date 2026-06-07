// GET /api/integrations/events -> the tenant's outbound event subscriptions.
import { eq, desc } from 'drizzle-orm';
import { requireTenant } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  const db = useDb();
  const items = await db.select({
    id: schema.integrationEvents.id, provider: schema.integrationEvents.provider,
    event: schema.integrationEvents.event, targetUrl: schema.integrationEvents.targetUrl,
    active: schema.integrationEvents.active, lastFiredAt: schema.integrationEvents.lastFiredAt,
    createdAt: schema.integrationEvents.createdAt
  }).from(schema.integrationEvents).where(eq(schema.integrationEvents.tenantId, s.tenantId)).orderBy(desc(schema.integrationEvents.createdAt));
  return { items };
});
