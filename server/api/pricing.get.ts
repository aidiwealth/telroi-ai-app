// GET /api/pricing -> client-facing pricing + the tenant's wallet currency.
// Used by the Numbers page to show channel/DID costs and the prorated estimate
// in the wallet's currency. Read-only, non-secret.
import { requireTenant } from '~/server/utils/api';
import { getPricing } from '~/server/utils/pricing';
import { getOrCreateWallet } from '~/server/utils/wallet';
export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  const p = await getPricing(s.tenantId);
  const wallet = await getOrCreateWallet(s.tenantId);
  return {
    currency: wallet.currency,
    channelMonthlyUsdMinor: p.channelMonthlyUsdMinor,
    didMonthlyUsdMinor: p.didMonthlyUsdMinor,
    voiceMinuteUsdMinor: p.voiceMinuteUsdMinor,
    // What a transcript costs, and how long a recording survives — both shown
    // where a client is deciding, rather than discovered afterwards.
    transcriptionMinuteUsdMicro: p.transcriptionMinuteUsdMicro,
    recordingDaysStartup: p.recordingDaysStartup,
    recordingDaysGrowth: p.recordingDaysGrowth,
    ngnPerUsd: p.ngnPerUsd
  };
});
