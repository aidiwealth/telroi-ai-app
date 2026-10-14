// POST /api/tenant/sub-accounts/:id/keys { name?, mode? } -> issue a key (raw shown once).
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { requireTenantManager, apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
import { sha256, randomToken, last4 } from '~/server/utils/crypto';
const Body = z.object({ name: z.string().min(1).max(120).optional(), mode: z.enum(['live','test']).default('live') });
export default defineEventHandler(async (event) => {
  const s = await requireTenantManager(event);
  const id = getRouterParam(event, 'id') || '';
  const p = Body.safeParse(await readBody(event));
  if (!p.success) throw apiError('invalid', 'Invalid body');
  const db = useDb();
  const [sa] = await db.select().from(schema.subAccounts)
    .where(and(eq(schema.subAccounts.id, id), eq(schema.subAccounts.parentTenantId, s.tenantId))).limit(1);
  if (!sa) throw apiError('not_found', 'Sub-account not found', 404);
  const prefix = `tlr_${p.data.mode}`;
  const secret = randomToken(24).replace(/[^a-zA-Z0-9]/g, '').slice(0, 32);
  const raw = `${prefix}_${secret}`;
  const [row] = await db.insert(schema.apiKeys).values({
    tenantId: s.tenantId, subAccountId: sa.id, name: p.data.name || `${sa.name} key`,
    prefix, keyHash: sha256(raw), last4: last4(raw), scopes: ['*']
  }).returning();
  return { id: row.id, name: row.name, key: raw, masked: `${prefix}_••••${row.last4}` };
});
