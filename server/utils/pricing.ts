// server/utils/pricing.ts
// Pricing math. The airtime rate ($0.0102/min) is sub-cent, so we compute call
// charges in MICRO-units (1/1,000,000 of a dollar) and round to minor units
// (cents) only at the point of debit — avoids rounding every minute to 1c.
import { eq } from 'drizzle-orm';
import { useDb, schema } from '../db';

const VOICE_MICRO_USD_PER_MIN = 10200; // $0.0102 = 10,200 micro-USD

/**
 * Rates, layered: global, then region, then tenant.
 *
 * A region is where the call lands rather than where the client is — a Lagos
 * business verifying a US number pays what that call costs us, not what a
 * Nigerian one would.
 *
 * The region is optional and every existing caller omits it, so nothing that
 * does not ask for one behaves differently.
 */
export async function getPricing(tenantId?: string, region?: string) {
  const db = useDb();
  const [p] = await db.select().from(schema.pricing).where(eq(schema.pricing.id, 'singleton')).limit(1);
  let base: any = p || {
    voiceMinuteUsdMinor: 1, voiceMinuteUsdMicro: VOICE_MICRO_USD_PER_MIN,
    voiceOtpUsdMicro: 10000, voiceNotifyUnitUsdMicro: 7500,
    channelMonthlyUsdMinor: 200, didMonthlyUsdMinor: 170,
    planStartupUsdMinor: 1000, planGrowthUsdMinor: 1500, ngnPerUsd: 1600
  } as any;
  // A region's rates sit over the global ones. Null columns fall through, so a
  // region can be listed for one rate before its other carrier cost is known.
  if (region) {
    try {
      const [rr] = await db.select().from(schema.regionRates)
        .where(eq(schema.regionRates.region, region)).limit(1);
      if (rr) {
        base = {
          ...base,
          voiceOtpUsdMicro: rr.voiceOtpUsdMicro ?? base.voiceOtpUsdMicro,
          voiceNotifyUnitUsdMicro: rr.voiceNotifyUnitUsdMicro ?? base.voiceNotifyUnitUsdMicro,
          voiceMinuteUsdMicro: rr.voiceMinuteUsdMicro ?? base.voiceMinuteUsdMicro
        } as any;
      }
    } catch { /* no region row is the same as no override */ }
  }

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
    voiceNotifyUnitUsdMicro: ov.voiceNotifyUnitUsdMicro ?? base.voiceNotifyUnitUsdMicro,
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

/** A voice notification: connected time at the voice rate, with a minimum of
 *  one minute.
 *
 *  The minimum is not a markup. Carriers bill a whole minute for a fifteen
 *  second call, which is the same reason OTP is charged flat — so billing a
 *  twenty second notification for twenty seconds would lose money on every one.
 *  Beyond a minute it is per second, as any call is.
 *
 *  The synthesis is charged separately and per character, because that is how
 *  the vendor charges us and a long message costs more to speak than a short
 *  one whatever its duration. */
/** Characters per unit, and seconds per unit. A notification is sold as one or
 *  the other, whichever is reached first. */
export const NOTIFY_CHARS_PER_UNIT = 160;
export const NOTIFY_SECONDS_PER_UNIT = 30;

/** How many units a notification costs.
 *
 *  Characters are perfectly predictable and seconds are what actually cost us,
 *  and the two diverge badly: ordinary prose runs about 13 characters a second,
 *  while "₦1,250,000.00 on 12/09/2026" is 27 characters and eight seconds of
 *  speech. Billing on whichever measure is greater means a numeral-dense alert
 *  pays for the time it really takes, and plain text pays the character rate.
 *  Neither side can be gamed.
 *
 *  Seconds are optional because the count is needed twice: as an estimate at
 *  submission, when only the text exists, and as the true figure after
 *  synthesis, when the audio file can be measured. */
export function notifyUnits(characters: number, seconds?: number): number {
  const byChars = Math.ceil(Math.max(1, characters) / NOTIFY_CHARS_PER_UNIT);
  const bySeconds = seconds && seconds > 0 ? Math.ceil(seconds / NOTIFY_SECONDS_PER_UNIT) : 1;
  return Math.max(1, byChars, bySeconds);
}

/** Roughly how long this text will take to say.
 *
 *  Not a flat rate per character. Ordinary prose runs about 13 characters a
 *  second, but "₦1,250,000.00 on 12/09/2026" is 27 characters and eight
 *  seconds — about 3.5 a second — because every digit is spoken as a word.
 *  A flat estimate would tell a customer their transaction alert is one unit
 *  and then bill two, which is the surprise this exists to remove.
 *
 *  The measured audio remains authoritative. This is for the submit endpoint,
 *  so nobody first learns the count at invoice time. */
export function estimateNotifySeconds(text: string): number {
  const PROSE_CHARS_PER_SEC = 13.3;
  const NUMERIC_CHARS_PER_SEC = 3.5;
  // Digits, currency symbols and the punctuation that binds them into amounts,
  // dates and account numbers. Read as words, not skimmed as text.
  const numeric = (text.match(/[0-9₦$£€.,:\/-]/g) || []).length;
  const prose = Math.max(0, text.length - numeric);
  const seconds = prose / PROSE_CHARS_PER_SEC + numeric / NUMERIC_CHARS_PER_SEC;
  // The preamble and the beat of silence before it, which are part of every
  // call and none of the text.
  return Math.round(seconds + 3);
}

/** What a notification costs the client, in their wallet's minor units.
 *
 *  Per unit rather than per minute. The minimum billable duration this used to
 *  apply was wrong: the carriers bill from answer with no floor, so a fifteen
 *  second notification was being charged a full minute. */
export function notifyCostMinor(
  characters: number,
  seconds: number | undefined,
  currency: 'NGN' | 'USD',
  ngnPerUsd: number,
  microUsdPerUnit: number
): number {
  const units = notifyUnits(characters, seconds);
  const rate = Number(microUsdPerUnit) > 0 ? Number(microUsdPerUnit) : 7500;
  const usdMinor = (units * rate) / 10000;
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
