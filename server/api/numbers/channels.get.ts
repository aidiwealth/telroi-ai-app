// GET /api/numbers/channels -> the tenant's channel capacity + live usage.
// Powers the "X of Y channels in use" indicator so customers see the limit
// they're paying for.
import { requireTenant } from '~/server/utils/api';
import { channelUsage } from '~/server/utils/channel-limits';
export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  return await channelUsage(s.tenantId);
});
