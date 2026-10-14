// GET /v1/sub-accounts/{id}
import { requireApiKey, hasScope } from '~/server/utils/apikey-auth';
import { apiError } from '~/server/utils/api';
import { and, eq } from 'drizzle-orm';
import { useDb, schema } from '~/server/db';

export default defineEventHandler(async (event) => {
  const ctx = await requireApiKey(event);
  if (!hasScope(ctx, 'subaccounts:read')) throw apiError('forbidden', 'Key lacks subaccounts:read', 403);
  const id = getRouterParam(event, 'id') || '';
  if (ctx.subAccountId && ctx.subAccountId !== id) throw apiError('forbidden', 'This key cannot read another sub-account', 403);
  const db = useDb();
  const [r] = await db.select().from(schema.subAccounts)
    .where(and(eq(schema.subAccounts.id, id), eq(schema.subAccounts.parentTenantId, ctx.tenantId))).limit(1);
  if (!r) throw apiError('not_found', 'Sub-account not found', 404);
  return { object: 'sub_account', id: r.id, name: r.name, reference: r.reference, status: r.status, created_at: r.createdAt };
});
