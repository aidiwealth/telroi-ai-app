// GET /api/billing/summary -> the client's recurring monthly billing picture:
// next billing date and the monthly recurring total (numbers + channels + plan
// fee), in their wallet currency. Read-only; derived from the same pricing and
// subscription data the billing engine charges from, so it always matches.
import { and, eq } from 'drizzle-orm';
import { requireTenant } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
import { getPricing, toCurrencyMinor, planFeeUsdMinor } from '~/server/utils/pricing';
import { getOrCreateWallet } from '~/server/utils/wallet';

export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  const db = useDb();
  const pricing = await getPricing(s.tenantId);
  const wallet = await getOrCreateWallet(s.tenantId);
  const cur = wallet.currency as 'NGN' | 'USD';
  const conv = (usdMinor: number) => toCurrencyMinor(usdMinor, cur, pricing.ngnPerUsd);

  const [tenant] = await db.select().from(schema.tenants).where(eq(schema.tenants.id, s.tenantId)).limit(1);

  const subs = await db.select().from(schema.numberSubscriptions)
    .where(and(eq(schema.numberSubscriptions.tenantId, s.tenantId), eq(schema.numberSubscriptions.status, 'active')));

  let numbersMinor = 0;
  let channelsTotal = 0;
  let nextNumberBill: Date | null = null;
  for (const sub of subs) {
    numbersMinor += conv(pricing.didMonthlyUsdMinor) + conv(pricing.channelMonthlyUsdMinor) * (sub.channels || 1);
    channelsTotal += (sub.channels || 1);
    const nb = sub.nextBillingAt ? new Date(sub.nextBillingAt) : null;
    if (nb && (!nextNumberBill || nb < nextNumberBill)) nextNumberBill = nb;
  }

  const onTrial = !!(tenant?.trialEndsAt && new Date(tenant.trialEndsAt) > new Date());
  const planUsd = planFeeUsdMinor(tenant?.plan || 'startup', pricing);
  const planMinor = onTrial ? 0 : conv(planUsd);
  const planNext = tenant?.planNextBillingAt ? new Date(tenant.planNextBillingAt) : null;

  const candidates = [nextNumberBill, planNext].filter(Boolean) as Date[];
  const nextBillingAt = candidates.length ? new Date(Math.min(...candidates.map((d) => d.getTime()))) : null;

  return {
    currency: cur,
    monthlyTotalMinor: numbersMinor + planMinor,
    breakdown: { numbersMinor, planMinor, planOnTrial: onTrial, numberCount: subs.length, channelCount: channelsTotal },
    nextBillingAt: nextBillingAt ? nextBillingAt.toISOString() : null,
    planNextBillingAt: planNext ? planNext.toISOString() : null
  };
});
