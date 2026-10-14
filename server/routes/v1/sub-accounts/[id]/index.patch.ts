// PATCH /v1/sub-accounts/{id}  { name?, status? }  (status: active | suspended)
// Parent key only. Suspending stops the sub-account's keys from authenticating.
import { z } from 'zod';
import { requireApiKey, hasScope } from '~/server/utils/apikey-auth';
import { apiError } from '~/server/utils/api';
import { and, eq } from 'drizzle-orm';
import { useDb, schema } from '~/server/db';

const Body = z.object({ name: z.string().min(1).max(120).optional(), status: z.enum(['active','suspended']).optional() });

export default defineEventHandler(async (event) => {
  const ctx = await requireApiKey(event);
  if (!hasScope(ctx, 'subaccounts:write')) throw apiError('forbidden', 'Key lacks subaccounts:write', 403);
  if (ctx.subAccountId) throw apiError('forbidden', 'A sub-account key cannot manage sub-accounts', 403);
  const id = getRouterParam(event, 'id') || '';
  const p = Body.safeParse(await readBody(event));
  if (!p.success || (!p.data.name && !p.data.status)) throw apiError('invalid', 'Provide name and/or status');
  const db = useDb();
  const patch: any = {};
  if (p.data.name) patch.name = p.data.name;
  if (p.data.status) patch.status = p.data.status;
  const [r] = await db.update(schema.subAccounts).set(patch)
    .where(and(eq(schema.subAccounts.id, id), eq(schema.subAccounts.parentTenantId, ctx.tenantId))).returning();
  if (!r) throw apiError('not_found', 'Sub-account not found', 404);
  return { object: 'sub_account', id: r.id, name: r.name, reference: r.reference, status: r.status, created_at: r.createdAt };
});
