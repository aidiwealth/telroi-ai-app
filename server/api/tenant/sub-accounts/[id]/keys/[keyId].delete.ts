// DELETE /api/tenant/sub-accounts/:id/keys/:keyId -> revoke a sub-account key.
import { and, eq } from 'drizzle-orm';
import { requireTenantManager } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
export default defineEventHandler(async (event) => {
  const s = await requireTenantManager(event);
  const id = getRouterParam(event, 'id') || '';
  const keyId = getRouterParam(event, 'keyId') || '';
  const db = useDb();
  await db.update(schema.apiKeys).set({ revokedAt: new Date() })
    .where(and(eq(schema.apiKeys.id, keyId), eq(schema.apiKeys.tenantId, s.tenantId), eq(schema.apiKeys.subAccountId, id)));
  return { ok: true };
});
