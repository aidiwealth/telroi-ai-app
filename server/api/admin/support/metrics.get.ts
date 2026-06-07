// GET /api/admin/support/metrics -> Live Call analytics for the Telroi Support workspace.
import { requirePlatformAdmin } from '~/server/utils/platform';
import { ensureSupportWorkspace } from '~/server/utils/support';
import { computeLiveCallMetrics } from '~/server/utils/live-call-metrics';
export default defineEventHandler(async (event) => {
  await requirePlatformAdmin(event);
  const ws = await ensureSupportWorkspace();
  return await computeLiveCallMetrics(ws.tenantId);
});
