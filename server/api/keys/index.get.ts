// GET /api/keys -> list this tenant's API keys (masked, never the raw key)
import { eq, desc } from 'drizzle-orm';
import { requireTenant } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  const db = useDb();
  const rows = await db.select().from(schema.apiKeys)
    .where(eq(schema.apiKeys.tenantId, s.tenantId)).orderBy(desc(schema.apiKeys.createdAt));
  return rows.map((k) => ({
    id: k.id, name: k.name, masked: `${k.prefix}_••••${k.last4}`,
    scopes: k.scopes, lastUsedAt: k.lastUsedAt, createdAt: k.createdAt,
    revoked: !!k.revokedAt
  }));
});
