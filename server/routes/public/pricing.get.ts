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
    }
  };
});
