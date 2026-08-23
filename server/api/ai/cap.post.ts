// POST /api/ai/cap { capUsdMinor }
//
// A client setting their own ceiling. Null returns them to the platform figure.
// They may set it lower than the default freely; raising it above is an
// operator's decision, since the ceiling is what bounds our vendor exposure as
// much as their bill.
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { requireTenantManager, apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';

const Body = z.object({ capUsdMinor: z.number().int().min(0).nullable() });

export default defineEventHandler(async (event) => {
  const s = await requireTenantManager(event);
  const p = Body.safeParse(await readBody(event));
  if (!p.success) throw apiError('invalid', 'Set a whole number of cents, or nothing to use the default');

  const { getPricing } = await import('~/server/utils/pricing');
  const pricing: any = await getPricing(s.tenantId).catch(() => null);
  const platform = pricing?.aiDailyCapUsdMinor ?? 500;

  // Zero means no ceiling, which a client cannot give themselves.
  // At or below the platform's figure, not strictly below it: a client typing
  // the number they were shown was being refused, which is a rule that reads as
  // a fault. Zero still means no ceiling and remains an operator's decision.
  if (p.data.capUsdMinor !== null && platform > 0 && (p.data.capUsdMinor === 0 || p.data.capUsdMinor > platform)) {
    throw apiError('above_platform',
      `The most you can set yourself is ${(platform / 100).toFixed(2)} a day in dollars. Ask support if you need more.`, 403);
  }

  await useDb().update(schema.tenants)
    .set({ aiDailyCapUsdMinor: p.data.capUsdMinor })
    .where(eq(schema.tenants.id, s.tenantId));

  return { ok: true };
});
