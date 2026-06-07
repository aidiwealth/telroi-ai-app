import { requireTenant, apiError } from '~/server/utils/api';
import { effectiveSettings, SETTINGS_CATALOG } from '~/server/utils/feature-settings';
export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  const feature = getRouterParam(event, 'feature') as any;
  if (!(feature in SETTINGS_CATALOG)) throw apiError('invalid', 'Unknown feature', 400);
  return await effectiveSettings(s.tenantId, feature, { forClient: true });
});
