// POST /api/ai/connections/:id/test -> validate the customer's own key
import { and, eq } from 'drizzle-orm';
import { requireTenant, apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
import { decrypt } from '~/server/utils/crypto';
import { testAiKey } from '~/server/utils/ai-test';

export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  const id = getRouterParam(event, 'id')!;
  const db = useDb();
  const [row] = await db.select().from(schema.aiConnections)
    .where(and(eq(schema.aiConnections.id, id), eq(schema.aiConnections.tenantId, s.tenantId))).limit(1);
  if (!row) throw apiError('not_found', 'Connection not found', 404);

  const result = await testAiKey(row.provider as any, decrypt(row.apiKeyEnc), row.meta as any);
  await db.update(schema.aiConnections)
    .set({ status: result.ok ? 'ok' : 'failed', lastTestedAt: new Date() })
    .where(eq(schema.aiConnections.id, id));
  return result;
});
