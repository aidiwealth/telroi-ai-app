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
    ngnPerUsd: rate,
    plans: {
      startup: pair(p.planStartupUsdMinor),
      growth: pair(p.planGrowthUsdMinor)
    },
    usage: {
      voiceMinute: pair(p.voiceMinuteUsdMinor),
      channelMonthly: pair(p.channelMonthlyUsdMinor),
      numberMonthly: pair(p.didMonthlyUsdMinor)
    },
    // Managed AI is charged by what it actually uses, which is why the page says
    // "included" today and a client discovers otherwise on their first invoice.
    // The units are small enough to be meaningless on their own, so an indicative
    // per-minute figure is given alongside them: a minute of conversation is
    // roughly 60s of listening, 900 characters spoken and 1,200 tokens thought.
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
           (Number(p.aiTtsPerCharNano) || 0) * 900 +
           (Number(p.aiLlmInPerTokNano) || 0) * 900 +
           (Number(p.aiLlmOutPerTokNano) || 0) * 300) *
          (1 + (Number(p.aiMarkupPct) || 0) / 100)
        )
      )
    }
  };
});
