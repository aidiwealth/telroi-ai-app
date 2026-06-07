import { requirePlatformAdmin } from '~/server/utils/platform';
import { apiError } from '~/server/utils/api';
import { resolveTenantByDomain } from '~/server/utils/resolve-tenant';
import { adminTenantSettingsView, SETTINGS_CATALOG } from '~/server/utils/feature-settings';
export default defineEventHandler(async (event) => {
  await requirePlatformAdmin(event);
  const feature = getRouterParam(event, 'feature') as any;
  if (!(feature in SETTINGS_CATALOG)) throw apiError('invalid', 'Unknown feature', 400);
  const t = await resolveTenantByDomain(decodeURIComponent(getRouterParam(event, 'domain')!));
  if (!t) throw apiError('not_found', 'Workspace not found', 404);
  return await adminTenantSettingsView(t.id, feature);
});
