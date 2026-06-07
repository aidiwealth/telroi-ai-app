// POST /api/admin/pricing/:tenantId -> set per-client rate overrides.
// Send null for a field to clear it (falls back to global).
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { requirePlatformAdmin } from '~/server/utils/platform';
import { apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
const Body = z.object({
  voiceMinuteUsdMinor: z.number().int().positive().nullable().optional(),
  channelMonthlyUsdMinor: z.number().int().positive().nullable().optional(),
  didMonthlyUsdMinor: z.number().int().positive().nullable().optional()
});
export default defineEventHandler(async (event) => {
  const admin = await requirePlatformAdmin(event);
  const tenantId = getRouterParam(event, 'tenantId')!;
  const p = Body.safeParse(await readBody(event));
  if (!p.success) throw apiError('invalid', 'Invalid override');
  const db = useDb();
  const patch = { ...p.data, updatedAt: new Date() };
  const [existing] = await db.select().from(schema.pricingOverrides).where(eq(schema.pricingOverrides.tenantId, tenantId)).limit(1);
  if (existing) await db.update(schema.pricingOverrides).set(patch).where(eq(schema.pricingOverrides.tenantId, tenantId));
  else await db.insert(schema.pricingOverrides).values({ tenantId, ...patch });
  return { ok: true };
});
