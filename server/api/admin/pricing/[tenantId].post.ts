// POST /api/admin/pricing/:tenantId -> set per-client rate overrides.
// Send null for a field to clear it (falls back to global).
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { requirePlatformAdmin } from '~/server/utils/platform';
import { apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
const Body = z.object({
  voiceMinuteUsdMinor: z.number().int().positive().nullable().optional(),  // legacy, not billed
  voiceMinuteUsdMicro: z.number().int().positive().nullable().optional(),  // micro-USD/min — this is what bills
  voiceOtpUsdMicro: z.number().int().positive().nullable().optional(),     // per OTP call
  voiceNotifyUnitUsdMicro: z.number().int().positive().nullable().optional(), // per notification unit
  vatRate: z.number().min(0).max(1).nullable().optional(),                 // rate, e.g. 0.075; null = platform default
  channelMonthlyUsdMinor: z.number().int().positive().nullable().optional(),
  didMonthlyUsdMinor: z.number().int().positive().nullable().optional(),
  // Plan prices for this client alone. A negotiated deal should not mean
  // editing the platform's price for everybody, and an annual figure set here
  // is what they pay if they are on the annual interval.
  planStartupUsdMinor: z.number().int().positive().nullable().optional(),
  planGrowthUsdMinor: z.number().int().positive().nullable().optional(),
  planStartupAnnualUsdMinor: z.number().int().positive().nullable().optional(),
  planGrowthAnnualUsdMinor: z.number().int().positive().nullable().optional()
});
export default defineEventHandler(async (event) => {
  const admin = await requirePlatformAdmin(event);
  const tenantId = getRouterParam(event, 'tenantId')!;
  const p = Body.safeParse(await readBody(event));
  if (!p.success) throw apiError('invalid', 'Invalid override');
  const db = useDb();
  // vat_rate is a numeric column — drizzle takes it as a string; keep null as null.
  const { vatRate, ...rest } = p.data as any;
  const patch: any = { ...rest, updatedAt: new Date() };
  if (vatRate !== undefined) patch.vatRate = vatRate === null ? null : String(vatRate);
  const [existing] = await db.select().from(schema.pricingOverrides).where(eq(schema.pricingOverrides.tenantId, tenantId)).limit(1);
  if (existing) await db.update(schema.pricingOverrides).set(patch).where(eq(schema.pricingOverrides.tenantId, tenantId));
  else await db.insert(schema.pricingOverrides).values({ tenantId, ...patch });
  return { ok: true };
});
