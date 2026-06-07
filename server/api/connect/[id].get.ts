import { and, eq } from 'drizzle-orm';
import { requireTenant, apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  const id = getRouterParam(event, 'id')!;
  const db = useDb();
  const [row] = await db.select().from(schema.connectFlows)
    .where(and(eq(schema.connectFlows.id, id), eq(schema.connectFlows.tenantId, s.tenantId))).limit(1);
  if (!row) throw apiError('not_found', 'Flow not found', 404);
  return row;
});
