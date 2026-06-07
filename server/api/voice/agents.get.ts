// GET /api/voice/agents -> Telroi users (with status)
import { requireTenant } from '~/server/utils/api';
import { telroiFor } from '~/server/utils/tenant';
export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  const client = await telroiFor(s.tenantId);
  return await client.listUsers({ with: 'status', ...getQuery(event) });
});
