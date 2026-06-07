import { and, eq } from 'drizzle-orm';
import { requireTenant } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  const id = getRouterParam(event, 'id')!;
  const db = useDb();
  await db.delete(schema.aiAgents).where(and(eq(schema.aiAgents.id, id), eq(schema.aiAgents.tenantId, s.tenantId)));
  return { ok: true };
});
