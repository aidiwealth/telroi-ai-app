// DELETE /api/ai/connections/:id
import { and, eq } from 'drizzle-orm';
import { requireTenant } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';

export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  const id = getRouterParam(event, 'id')!;
  const db = useDb();
  await db.delete(schema.aiConnections).where(and(eq(schema.aiConnections.id, id), eq(schema.aiConnections.tenantId, s.tenantId)));
  return { ok: true };
});
