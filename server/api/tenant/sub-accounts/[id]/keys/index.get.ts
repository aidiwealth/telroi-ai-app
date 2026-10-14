// GET /api/tenant/sub-accounts/:id/keys -> keys for a sub-account (masked).
import { and, eq, desc } from 'drizzle-orm';
import { requireTenant, apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  const id = getRouterParam(event, 'id') || '';
  const db = useDb();
  const [sa] = await db.select({ id: schema.subAccounts.id }).from(schema.subAccounts)
    .where(and(eq(schema.subAccounts.id, id), eq(schema.subAccounts.parentTenantId, s.tenantId))).limit(1);
  if (!sa) throw apiError('not_found', 'Sub-account not found', 404);
  const rows = await db.select().from(schema.apiKeys)
    .where(and(eq(schema.apiKeys.tenantId, s.tenantId), eq(schema.apiKeys.subAccountId, id)))
    .orderBy(desc(schema.apiKeys.createdAt));
  return { keys: rows.map((k) => ({ id: k.id, name: k.name, masked: `${k.prefix}_••••${k.last4}`,
    lastUsedAt: k.lastUsedAt, createdAt: k.createdAt, revoked: !!k.revokedAt })) };
});
