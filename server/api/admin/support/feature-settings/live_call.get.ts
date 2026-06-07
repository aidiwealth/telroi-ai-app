import { requirePlatformAdmin } from '~/server/utils/platform';
import { ensureSupportWorkspace } from '~/server/utils/support';
import { effectiveSettings } from '~/server/utils/feature-settings';
export default defineEventHandler(async (event) => {
  await requirePlatformAdmin(event);
  const ws = await ensureSupportWorkspace();
  return await effectiveSettings(ws.tenantId, 'live_call');
});
