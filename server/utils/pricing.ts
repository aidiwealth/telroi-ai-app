// server/utils/pricing.ts
// Pricing math. The airtime rate ($0.0102/min) is sub-cent, so we compute call
// charges in MICRO-units (1/1,000,000 of a dollar) and round to minor units
// (cents) only at the point of debit — avoids rounding every minute to 1c.
import { eq } from 'drizzle-orm';
import { useDb, schema } from '../db';

const VOICE_MICRO_USD_PER_MIN = 10200; // $0.0102 = 10,200 micro-USD

export async function getPricing(tenantId?: string) {
  const db = useDb();
  const [p] = await db.select().from(schema.pricing).where(eq(schema.pricing.id, 'singleton')).limit(1);
  const base = p || {
    voiceMinuteUsdMinor: 1, voiceMinuteUsdMicro: VOICE_MICRO_USD_PER_MIN,
    voiceOtpUsdMicro: 10000,
    channelMonthlyUsdMinor: 200, didMonthlyUsdMinor: 170,
    planStartupUsdMinor: 1000, planGrowthUsdMinor: 1500, ngnPerUsd: 1600
  } as any;
  if (!tenantId) return base;
  // Layer any per-tenant override on top (null fields fall back to global).
  const [ov] = await db.select().from(schema.pricingOverrides).where(eq(schema.pricingOverrides.tenantId, tenantId)).limit(1);
  if (!ov) return base;
  return {
    ...base,
    voiceMinuteUsdMinor: ov.voiceMinuteUsdMinor ?? base.voiceMinuteUsdMinor,
    voiceMinuteUsdMicro: ov.voiceMinuteUsdMicro ?? base.voiceMinuteUsdMicro,
    // Per OTP call rather than per minute — the carriers bill a whole minute for
    // a fifteen-second call, so duration billing would lose money on every one.
    voiceOtpUsdMicro: ov.voiceOtpUsdMicro ?? base.voiceOtpUsdMicro,
    channelMonthlyUsdMinor: ov.channelMonthlyUsdMinor ?? base.channelMonthlyUsdMinor,
    didMonthlyUsdMinor: ov.didMonthlyUsdMinor ?? base.didMonthlyUsdMinor
  };
}

/** Convert a USD minor amount (cents) to the wallet currency's minor units. */
export function toCurrencyMinor(usdMinor: number, currency: 'NGN' | 'USD', ngnPerUsd: number): number {
  if (currency === 'USD') return Math.round(usdMinor);
  // USD cents -> NGN kobo: (cents/100 USD) * ngnPerUsd NGN * 100 kobo
  return Math.round(usdMinor * ngnPerUsd);
}

/** Cost of N seconds of airtime, in the wallet currency's minor units. */
export function voiceCostMinor(
  seconds: number,
  currency: 'NGN' | 'USD',
  ngnPerUsd: number,
  microUsdPerMin: number = VOICE_MICRO_USD_PER_MIN
): number {
  const minutes = seconds / 60;
  const rate = Number(microUsdPerMin) > 0 ? Number(microUsdPerMin) : VOICE_MICRO_USD_PER_MIN;
  const microUsd = Math.ceil(minutes * rate); // bill rounded-up partial minutes
  const usdMinor = microUsd / 10000; // micro-USD -> cents (1c = 10,000 micro)
  return currency === 'USD'
    ? Math.max(1, Math.round(usdMinor))
    : Math.max(1, Math.round(usdMinor * ngnPerUsd));
}

/** What one OTP call costs the client, in their wallet's minor units. Flat per
 *  call rather than per minute: the carriers bill a whole minute for a fifteen
 *  second call, so charging by duration would lose money on every one. */
export function otpCostMinor(currency: 'NGN' | 'USD', ngnPerUsd: number, microUsdPerCall: number): number {
  const usdMinor = (Number(microUsdPerCall) > 0 ? Number(microUsdPerCall) : 10000) / 10000;
  return currency === 'USD'
    ? Math.max(1, Math.round(usdMinor))
    : Math.max(1, Math.round(usdMinor * ngnPerUsd));
}

/** What a plan costs for one billing period.
 *
 *  interval decides which price and, at the call site, how far the next billing
 *  date moves. A workspace on annual pays once and is not seen again for a year.
 *
 *  An override falls back to the platform price rather than to zero: a client
 *  given a negotiated monthly rate should not become free the moment they switch
 *  to annual because nobody set that figure too.
 */
export function planFeeUsdMinor(plan: string, p: any, interval: 'monthly' | 'annual' = 'monthly'): number {
  if (interval === 'annual') {
    if (plan === 'growth') return p.planGrowthAnnualUsdMinor ?? p.planGrowthUsdMinor * 12;
    if (plan === 'startup') return p.planStartupAnnualUsdMinor ?? p.planStartupUsdMinor * 12;
    return 0;
  }
  if (plan === 'growth') return p.planGrowthUsdMinor;
  if (plan === 'startup') return p.planStartupUsdMinor;
  return 0; // custom = quoted separately
}
