// POST /api/tenant/sub-accounts { name, reference? }
import { z } from 'zod';
import { requireTenantManager, apiError } from '~/server/utils/api';
import { eq } from 'drizzle-orm';
import { useDb, schema } from '~/server/db';
const Body = z.object({ name: z.string().min(1).max(120), reference: z.string().max(120).optional() });
export default defineEventHandler(async (event) => {
  const s = await requireTenantManager(event);
  const p = Body.safeParse(await readBody(event));
  if (!p.success) throw apiError('invalid', 'Name is required');
  const db = useDb();
  const [tt] = await db.select({ on: schema.tenants.subAccountsEnabled }).from(schema.tenants).where(eq(schema.tenants.id, s.tenantId)).limit(1);
  if (!tt?.on) throw apiError('sub_accounts_disabled', 'Sub-accounts are not enabled for this workspace.', 403);
  const [row] = await db.insert(schema.subAccounts).values({
    parentTenantId: s.tenantId, name: p.data.name, reference: p.data.reference || null
  }).returning();
  return { id: row.id, name: row.name, reference: row.reference, status: row.status, createdAt: row.createdAt };
});
