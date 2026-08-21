// POST /api/admin/pricing -> update global rates (minor units / cents).
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { requireSuperAdmin } from '~/server/utils/platform';
import { apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
const Body = z.object({
  voiceMinuteUsdMicro: z.number().int().positive().optional(),  // micro-USD/min, e.g. 10200 = $0.0102
  channelMonthlyUsdMinor: z.number().int().positive().optional(),
  didMonthlyUsdMinor: z.number().int().positive().optional(),
  planStartupUsdMinor: z.number().int().positive().optional(),
  // Annual as a price, not a discount: "$150 a year" is quotable and a
  // percentage is not, and the saving is derived for display.
  planStartupAnnualUsdMinor: z.number().int().positive().optional(),
  planGrowthAnnualUsdMinor: z.number().int().positive().optional(),
  planGrowthUsdMinor: z.number().int().positive().optional(),
  ngnPerUsd: z.number().int().positive().optional(),
  // Micro like airtime: a cent cannot express two thousandths of one.
  transcriptionMinuteUsdMicro: z.number().int().min(0).optional(),
  // Bounded because a retention of zero deletes on arrival and a retention of
  // years is a storage bill nobody chose.
  recordingDaysStartup: z.number().int().min(1).max(365).optional(),
  recordingDaysGrowth: z.number().int().min(1).max(365).optional(),
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
