import { requirePlatformAdmin } from '~/server/utils/platform';
import { apiError } from '~/server/utils/api';
import { savePlatformSettings, SETTINGS_CATALOG } from '~/server/utils/feature-settings';
export default defineEventHandler(async (event) => {
  const admin = await requirePlatformAdmin(event);
  const feature = getRouterParam(event, 'feature') as any;
  if (!(feature in SETTINGS_CATALOG)) throw apiError('invalid', 'Unknown feature', 400);
  const body = await readBody(event);
  const { logEvent } = await import('~/server/utils/logs');
  const res = await savePlatformSettings(feature, body?.settings || {}, body?.locks || []);
  await logEvent({ kind: 'system', action: 'feature_settings.platform', summary: `Updated ${feature} platform defaults` });
  return res;
});
