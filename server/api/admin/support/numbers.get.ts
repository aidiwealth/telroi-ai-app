// GET /api/admin/support/numbers -> the support workspace's callable numbers.
// Returns the admin-configured per-region support numbers (from Settings) as the
// primary, approved list — these power the admin dialer, VAN picker and support
// calls. Falls back to all assignable support numbers if none configured yet.
import { requirePlatformAdmin } from '~/server/utils/platform';
import { platformSettings } from '~/server/utils/platform';
import { assignableSupportNumbers } from '~/server/utils/support-numbers';
export default defineEventHandler(async (event) => {
  await requirePlatformAdmin(event);
  const s = await platformSettings();
  const map = (s?.supportNumbersByRegion || {}) as { NG?: string; INTL?: string };
  const all = await assignableSupportNumbers();
  const byTel = new Map(all.map((n) => [n.telnum, n]));
  // Approved = the numbers admin designated per region in Settings.
  const approved: any[] = [];
  if (map.NG) approved.push({ telnum: map.NG, region: 'NG', provider: byTel.get(map.NG)?.provider || 'telroi', label: 'Nigeria', status: 'active' });
  if (map.INTL) approved.push({ telnum: map.INTL, region: byTel.get(map.INTL)?.region || 'US', provider: byTel.get(map.INTL)?.provider || 'telnyx', label: 'International', status: 'active' });
  // If nothing configured yet, expose all assignable numbers so the admin can still act.
  const numbers = approved.length ? approved : all.map((n) => ({ ...n, status: 'active' }));
  return { numbers, configured: approved.length > 0 };
});
