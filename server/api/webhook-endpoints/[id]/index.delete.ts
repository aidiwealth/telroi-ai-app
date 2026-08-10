// DELETE /api/webhook-endpoints/:id -> stop sending here.
import { eq, and } from 'drizzle-orm';
import { requireTenant, apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';

export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  if (s.role && !['owner', 'admin'].includes(s.role)) {
    throw apiError('forbidden', 'Only workspace owners or admins can change webhooks.', 403);
  }
  const id = getRouterParam(event, 'id')!;
  const db = useDb();
  const [row] = await db.select().from(schema.webhookEndpoints)
    .where(and(eq(schema.webhookEndpoints.id, id), eq(schema.webhookEndpoints.tenantId, s.tenantId))).limit(1);
  if (!row) throw apiError('not_found', 'Endpoint not found', 404);

  // Queued deliveries go with it — sending to an address somebody has just
  // removed is worse than dropping a handful of events.
  await db.delete(schema.webhookEndpoints).where(eq(schema.webhookEndpoints.id, id));
  return { ok: true };
});
