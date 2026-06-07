// GET /api/live-call/metrics -> full Live Call analytics for the client.
import { requireTenant } from '~/server/utils/api';
import { computeLiveCallMetrics } from '~/server/utils/live-call-metrics';
export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  return await computeLiveCallMetrics(s.tenantId);
});
