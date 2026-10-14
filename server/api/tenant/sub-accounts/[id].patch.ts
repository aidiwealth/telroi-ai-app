// PATCH /api/tenant/sub-accounts/:id { name?, status? }
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { requireTenantManager, apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
const Body = z.object({ name: z.string().min(1).max(120).optional(), status: z.enum(['active','suspended']).optional() });
export default defineEventHandler(async (event) => {
  const s = await requireTenantManager(event);
  const id = getRouterParam(event, 'id') || '';
  const p = Body.safeParse(await readBody(event));
  if (!p.success || (!p.data.name && !p.data.status)) throw apiError('invalid', 'Nothing to update');
  const db = useDb();
  const patch: any = {};
  if (p.data.name) patch.name = p.data.name;
  if (p.data.status) patch.status = p.data.status;
  const [row] = await db.update(schema.subAccounts).set(patch)
    .where(and(eq(schema.subAccounts.id, id), eq(schema.subAccounts.parentTenantId, s.tenantId))).returning();
  if (!row) throw apiError('not_found', 'Sub-account not found', 404);
  return { id: row.id, name: row.name, reference: row.reference, status: row.status };
});
