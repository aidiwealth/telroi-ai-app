import { requirePlatformAdmin } from '~/server/utils/platform';
import { apiError } from '~/server/utils/api';
import { resolveTenantByDomain } from '~/server/utils/resolve-tenant';
import { adminSaveTenantSettings, SETTINGS_CATALOG } from '~/server/utils/feature-settings';
export default defineEventHandler(async (event) => {
  const admin = await requirePlatformAdmin(event);
  if (admin.role !== 'superadmin') throw apiError('forbidden', 'Superadmin required', 403);
  const feature = getRouterParam(event, 'feature') as any;
  if (!(feature in SETTINGS_CATALOG)) throw apiError('invalid', 'Unknown feature', 400);
  const t = await resolveTenantByDomain(decodeURIComponent(getRouterParam(event, 'domain')!));
  if (!t) throw apiError('not_found', 'Workspace not found', 404);
  const body = await readBody(event);
  const { logEvent } = await import('~/server/utils/logs');
  const res = await adminSaveTenantSettings(t.id, feature, body?.settings || {});
  await logEvent({ tenantId: t.id, kind: 'system', action: 'feature_settings.tenant', summary: `Admin updated ${feature} settings for ${t.name}` });
  return res;
});
