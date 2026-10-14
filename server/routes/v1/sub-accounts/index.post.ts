// POST /v1/sub-accounts  { name, reference? }
// Create a sub-account under the calling tenant. Only a PARENT key may do this
// (a key that itself belongs to a sub-account is refused). Usage by the
// sub-account bills the parent tenant's wallet; the sub-account is an
// attribution + visibility boundary, not a separate billing entity.
import { z } from 'zod';
import { requireApiKey, hasScope } from '~/server/utils/apikey-auth';
import { apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';

const Body = z.object({ name: z.string().min(1).max(120), reference: z.string().max(120).optional() });

export default defineEventHandler(async (event) => {
  const ctx = await requireApiKey(event);
  if (!hasScope(ctx, 'subaccounts:write')) throw apiError('forbidden', 'Key lacks subaccounts:write', 403);
  if (ctx.subAccountId) throw apiError('forbidden', 'A sub-account key cannot create sub-accounts', 403);
  {
    const { eq } = await import('drizzle-orm');
    const [tt] = await useDb().select({ on: schema.tenants.subAccountsEnabled }).from(schema.tenants).where(eq(schema.tenants.id, ctx.tenantId)).limit(1);
    if (!tt?.on) throw apiError('sub_accounts_disabled', 'Sub-accounts are not enabled for this workspace.', 403);
  }
  const p = Body.safeParse(await readBody(event));
  if (!p.success) throw apiError('invalid', 'name is required');
  const db = useDb();
  const [row] = await db.insert(schema.subAccounts).values({
    parentTenantId: ctx.tenantId, name: p.data.name, reference: p.data.reference || null
  }).returning();
  return { object: 'sub_account', id: row.id, name: row.name, reference: row.reference, status: row.status, created_at: row.createdAt };
});
