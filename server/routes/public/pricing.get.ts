// GET /public/pricing — list prices for the marketing site.
//
// The signed-in endpoint at /api/pricing needs a session and answers in the
// tenant's own currency, so the marketing site couldn't read it and its figures
// were written by hand — which means they drift from what we actually charge,
// and nobody notices until a customer does.
//
// Only what a visitor would see on a pricing page. The pricing table also holds
// our own cost figures and markup, which are ours rather than theirs.
import { getPricing } from '~/server/utils/pricing';

export default defineEventHandler(async (event) => {
  setHeader(event, 'access-control-allow-origin', '*');
  // A minute of caching: the marketing site can be busy, and prices change rarely.
  setHeader(event, 'cache-control', 'public, max-age=60');

  const p: any = await getPricing();
  const rate = Number(p.ngnPerUsd) || 1600;
  // Both currencies, because most of the people reading the pricing page will pay
  // in naira and showing them dollars undersells the fit.
  const pair = (usdMinor: number) => ({
    usdMinor: Number(usdMinor) || 0,
    ngnMinor: Math.round((Number(usdMinor) || 0) * rate)
  });
  // AI accrues in billionths of a dollar, so cents would round most of it to
  // nothing — the same mistake that had managed AI billing zero for months.
  const nanoPair = (nano: number) => ({
    usdNano: Number(nano) || 0,
    ngnNano: Math.round((Number(nano) || 0) * rate)
  });

  return {
    object: 'pricing',
    // Said plainly: a page reading ngnMinor as naira would advertise sixteen
    // thousand times the price, and the field name alone hasn't stopped that
    // mistake being made elsewhere.
    units: 'Minor units — usdMinor is cents, ngnMinor is kobo. Nano fields are billionths.',
    ngnPerUsd: rate,
    plans: {
      startup: pair(p.planStartupUsdMinor),
      growth: pair(p.planGrowthUsdMinor),
      // Annual is stored as a price rather than a discount, because "$150 a
      // year" is a thing somebody can quote and 16.67% is not. The saving is
      // derived here so the marketing page does not have to work it out and
      // does not drift when a price changes.
      annual: {
        startup: pair(p.planStartupAnnualUsdMinor),
        growth: pair(p.planGrowthAnnualUsdMinor),
        // Whole percent, rounded down: better to under-claim a saving than to
        // advertise one the arithmetic does not support.
        savePctStartup: p.planStartupUsdMinor > 0
          ? Math.floor((1 - (p.planStartupAnnualUsdMinor / (p.planStartupUsdMinor * 12))) * 100) : 0,
        savePctGrowth: p.planGrowthUsdMinor > 0
          ? Math.floor((1 - (p.planGrowthAnnualUsdMinor / (p.planGrowthUsdMinor * 12))) * 100) : 0,
        monthsFreeStartup: p.planStartupUsdMinor > 0
          ? Math.round((p.planStartupUsdMinor * 12 - p.planStartupAnnualUsdMinor) / p.planStartupUsdMinor * 10) / 10 : 0,
        monthsFreeGrowth: p.planGrowthUsdMinor > 0
          ? Math.round((p.planGrowthUsdMinor * 12 - p.planGrowthAnnualUsdMinor) / p.planGrowthUsdMinor * 10) / 10 : 0
      }
    },
    usage: {
      // Airtime is sub-cent: the whole-cent pair rounds $0.0102 down to $0.01 and
      // under-quotes what we bill. usdMinor stays for anything already reading it,
      // but the nano fields are the rate calls are actually charged at.
      voiceMinute: {
        ...pair(p.voiceMinuteUsdMinor),
        ...nanoPair(Math.round((Number(p.voiceMinuteUsdMicro) || 10200) * 1000))
      },
      channelMonthly: pair(p.channelMonthlyUsdMinor),
      numberMonthly: pair(p.didMonthlyUsdMinor),
      // Flat per call rather than per minute: a carrier bills a whole minute for
      // a fifteen-second OTP, so charging by duration loses money on every one.
      // Sub-cent like airtime, so the nano fields are the real rate.
      voiceOtpCall: {
        ...pair(Math.round((Number(p.voiceOtpUsdMicro) || 10000) / 10000)),
        ...nanoPair(Math.round((Number(p.voiceOtpUsdMicro) || 10000) * 1000))
      }
    },
    // Managed AI is charged by what it actually uses, which is why the page says
    // "included" today and a client discovers otherwise on their first invoice.
    // The units are meaningless on their own, so an indicative per-minute figure
    // is given alongside — drawn from what real calls actually consume rather
    // than a guess: replies run about 50 characters and a minute holds six or
    // seven turns, so far less speech than an unhurried estimate would suggest.
    ai: {
      note: 'Charged from your wallet when using Telroi-provided AI. Bring your own provider keys and you pay them directly instead.',
      markupPct: Number(p.aiMarkupPct) || 0,
      units: {
        sttPerSecond: nanoPair(p.aiSttPerSecNano),
        ttsPerCharacter: nanoPair(p.aiTtsPerCharNano),
        llmInputPerToken: nanoPair(p.aiLlmInPerTokNano),
        llmOutputPerToken: nanoPair(p.aiLlmOutPerTokNano)
      },
      indicativePerMinute: nanoPair(
        Math.round(
          ((Number(p.aiSttPerSecNano) || 0) * 60 +
           (Number(p.aiTtsPerCharNano) || 0) * 350 +
           (Number(p.aiLlmInPerTokNano) || 0) * 700 +
           (Number(p.aiLlmOutPerTokNano) || 0) * 120) *
          (1 + (Number(p.aiMarkupPct) || 0) / 100)
        )
      )
    }
  };
});
