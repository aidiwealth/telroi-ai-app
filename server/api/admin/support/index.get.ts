// GET /api/admin/support -> status of the shared Telroi Support workspace
// (readiness to place calls + wallet balance), so the admin UI can show it.
import { requirePlatformAdmin } from '~/server/utils/platform';
import { ensureSupportWorkspace } from '~/server/utils/support';
import { getOrCreateWallet } from '~/server/utils/wallet';
import { platformSettings } from '~/server/utils/platform';

export default defineEventHandler(async (event) => {
  await requirePlatformAdmin(event);
  const support = await ensureSupportWorkspace();
  const wallet = await getOrCreateWallet(support.tenantId);
  const settings = await platformSettings();
  // The support line is ready to place calls when at least one per-region support
  // number is configured (NG or International). The legacy single field counts too.
  const map = (settings?.supportNumbersByRegion || {}) as { NG?: string; INTL?: string };
  const hasNumber = !!(map.NG || map.INTL || settings?.supportTelnum);
  return {
    ready: hasNumber,
    pbxProvisioned: support.provisioned,
    telnum: settings?.supportTelnum || null,
    supportNumbersByRegion: map,
    wallet: { balanceMinor: wallet.balanceMinor, currency: wallet.currency }
  };
});
