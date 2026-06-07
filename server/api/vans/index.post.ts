// POST /api/vans -> create a Virtual AI Number
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { requireTenant, apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
const Body = z.object({
  name: z.string().min(1),
  telnum: z.string().min(3),
  agentId: z.string().uuid().optional(),
  languages: z.array(z.string()).optional(),
  escalateTo: z.string().optional(),
  escalateAfter: z.number().int().min(0).optional(),
  crmWriteback: z.boolean().optional()
});
export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  const p = Body.safeParse(await readBody(event));
  if (!p.success) throw apiError('invalid', 'VAN name and number required');
  const db = useDb();

  // The number must be one the tenant owns. Its carrier is whatever it was
  // provisioned on (admin-set) — the customer never chooses it; we use it.
  const [sub] = await db.select().from(schema.numberSubscriptions)
    .where(and(eq(schema.numberSubscriptions.telnum, p.data.telnum), eq(schema.numberSubscriptions.tenantId, s.tenantId)))
    .limit(1);
  if (!sub) throw apiError('not_owned', 'Buy this number on the Numbers page before assigning it.', 400);

  const [row] = await db.insert(schema.vans).values({
    tenantId: s.tenantId, ...p.data, provider: sub.provider // carried automatically from the number
  }).returning();
  const { touchActivity } = await import('~/server/utils/activity');
  await touchActivity(s.tenantId);
  return row;
});
