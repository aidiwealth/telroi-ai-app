// POST /api/admin/support/ai/connections/:id/test -> check the key actually works.
//
// This used to set status to 'ok' without contacting the provider, on the reasoning
// that the real check happened elsewhere — it doesn't, and hasn't for a while. So
// every support connection read as working whether or not it did, which is worse
// than no check at all: an operator saw a green tick and had no reason to look
// further. The ElevenLabs key that was failing with a 401 showed 'ok' here.
import { and, eq } from 'drizzle-orm';
import { requirePlatformAdmin } from '~/server/utils/platform';
import { ensureSupportWorkspace } from '~/server/utils/support';
import { apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
import { decrypt } from '~/server/utils/crypto';
import { testAiKey } from '~/server/utils/ai-test';

export default defineEventHandler(async (event) => {
  await requirePlatformAdmin(event);
  const ws = await ensureSupportWorkspace();
  const id = getRouterParam(event, 'id')!;
  const db = useDb();
  const [row] = await db.select().from(schema.aiConnections)
    .where(and(eq(schema.aiConnections.id, id), eq(schema.aiConnections.tenantId, ws.tenantId))).limit(1);
  if (!row) throw apiError('not_found', 'Connection not found', 404);

  const result = await testAiKey(row.provider as any, decrypt(row.apiKeyEnc), row.meta as any);
  await db.update(schema.aiConnections)
    .set({ status: result.ok ? 'ok' : 'failed', lastTestedAt: new Date() })
    .where(eq(schema.aiConnections.id, id));
  return result;
});
