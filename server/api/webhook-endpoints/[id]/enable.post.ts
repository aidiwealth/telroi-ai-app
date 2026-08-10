// POST /api/webhook-endpoints/:id/enable -> switch it back on.
//
// We disable an endpoint after twenty consecutive failures, which is a judgement
// about load rather than about them. Turning it back on is theirs to do, and
// resets the count so a fixed endpoint gets a clean run.
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

  await db.update(schema.webhookEndpoints)
    .set({ enabled: true, consecutiveFailures: 0, disabledReason: null })
    .where(eq(schema.webhookEndpoints.id, id));
  return { ok: true };
});
