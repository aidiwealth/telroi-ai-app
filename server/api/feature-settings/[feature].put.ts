import { requireTenantManager, apiError } from '~/server/utils/api';
import { saveTenantSettings, SETTINGS_CATALOG } from '~/server/utils/feature-settings';
export default defineEventHandler(async (event) => {
  const s = await requireTenantManager(event);
  const feature = getRouterParam(event, 'feature') as any;
  if (!(feature in SETTINGS_CATALOG)) throw apiError('invalid', 'Unknown feature', 400);
  const body = await readBody(event);
  return await saveTenantSettings(s.tenantId, feature, body?.settings || {});
});
