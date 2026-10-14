// GET /v1/sub-accounts -> list the calling tenant's sub-accounts.
import { requireApiKey, hasScope } from '~/server/utils/apikey-auth';
import { apiError } from '~/server/utils/api';
import { and, eq, desc } from 'drizzle-orm';
import { useDb, schema } from '~/server/db';

export default defineEventHandler(async (event) => {
  const ctx = await requireApiKey(event);
  if (!hasScope(ctx, 'subaccounts:read')) throw apiError('forbidden', 'Key lacks subaccounts:read', 403);
  // A sub-account key sees only itself; a parent key sees all its sub-accounts.
  const db = useDb();
  const where = ctx.subAccountId
    ? and(eq(schema.subAccounts.parentTenantId, ctx.tenantId), eq(schema.subAccounts.id, ctx.subAccountId))
    : eq(schema.subAccounts.parentTenantId, ctx.tenantId);
  const rows = await db.select().from(schema.subAccounts).where(where).orderBy(desc(schema.subAccounts.createdAt));
  return { object: 'list', data: rows.map((r) => ({ id: r.id, name: r.name, reference: r.reference, status: r.status, created_at: r.createdAt })) };
});
