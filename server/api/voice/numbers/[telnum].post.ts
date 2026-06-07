// POST /api/voice/numbers/:telnum -> update incoming routing on the PBX
import { requireTenant } from '~/server/utils/api';
import { telroiFor } from '~/server/utils/tenant';
export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  const telnum = getRouterParam(event, 'telnum')!;
  const client = await telroiFor(s.tenantId);
  return await client.editNumberRoute(telnum, await readBody(event));
});
