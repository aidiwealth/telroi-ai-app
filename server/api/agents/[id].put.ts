import { and, eq } from 'drizzle-orm';
import { requireTenant } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  const id = getRouterParam(event, 'id')!;
  const db = useDb();
  const [row] = await db.update(schema.aiAgents).set(await readBody(event))
    .where(and(eq(schema.aiAgents.id, id), eq(schema.aiAgents.tenantId, s.tenantId))).returning();
  return row;
});
