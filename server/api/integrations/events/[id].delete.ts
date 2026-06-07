// DELETE /api/integrations/events/:id -> remove an event subscription.
import { and, eq } from 'drizzle-orm';
import { requireTenantManager, apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
export default defineEventHandler(async (event) => {
  const s = await requireTenantManager(event);
  const id = getRouterParam(event, 'id');
  if (!id) throw apiError('invalid', 'id required');
  const db = useDb();
  await db.delete(schema.integrationEvents).where(and(eq(schema.integrationEvents.id, id), eq(schema.integrationEvents.tenantId, s.tenantId)));
  return { ok: true };
});
