import { requirePlatformAdmin } from '~/server/utils/platform';
import { apiError } from '~/server/utils/api';
import { platformSettingsView, SETTINGS_CATALOG } from '~/server/utils/feature-settings';
export default defineEventHandler(async (event) => {
  await requirePlatformAdmin(event);
  const feature = getRouterParam(event, 'feature') as any;
  if (!(feature in SETTINGS_CATALOG)) throw apiError('invalid', 'Unknown feature', 400);
  return await platformSettingsView(feature);
});
