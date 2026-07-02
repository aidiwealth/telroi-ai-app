// POST /api/admin/pricing -> update global rates (minor units / cents).
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { requireSuperAdmin } from '~/server/utils/platform';
import { apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
const Body = z.object({
  channelMonthlyUsdMinor: z.number().int().positive().optional(),
  didMonthlyUsdMinor: z.number().int().positive().optional(),
  planStartupUsdMinor: z.number().int().positive().optional(),
  planGrowthUsdMinor: z.number().int().positive().optional(),
  ngnPerUsd: z.number().int().positive().optional(),
  aiSttPerSecNano: z.number().int().nonnegative().optional(),
  aiLlmInPerTokNano: z.number().int().nonnegative().optional(),
  aiLlmOutPerTokNano: z.number().int().nonnegative().optional(),
  aiTtsPerCharNano: z.number().int().nonnegative().optional(),
  aiMarkupPct: z.number().int().min(0).max(1000).optional()
});
export default defineEventHandler(async (event) => {
  const admin = await requireSuperAdmin(event);
  const p = Body.safeParse(await readBody(event));
  if (!p.success) throw apiError('invalid', 'Invalid pricing');
  const db = useDb();
  const patch = { ...p.data, updatedAt: new Date() };
  const [existing] = await db.select().from(schema.pricing).where(eq(schema.pricing.id, 'singleton')).limit(1);
  if (existing) await db.update(schema.pricing).set(patch).where(eq(schema.pricing.id, 'singleton'));
  else await db.insert(schema.pricing).values({ id: 'singleton', ...patch });
  return { ok: true };
});
