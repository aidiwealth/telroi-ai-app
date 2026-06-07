import { requirePlatformAdmin } from '~/server/utils/platform';
import { ensureSupportWorkspace } from '~/server/utils/support';
import { saveTenantSettings } from '~/server/utils/feature-settings';
export default defineEventHandler(async (event) => {
  await requirePlatformAdmin(event);
  const ws = await ensureSupportWorkspace();
  const body = await readBody(event);
  return await saveTenantSettings(ws.tenantId, 'live_call', body?.settings || {});
});
