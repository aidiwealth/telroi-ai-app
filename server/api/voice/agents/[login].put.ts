// PUT /api/voice/agents/:login -> edit a Telroi user (agent)
import { requireTenant } from '~/server/utils/api';
import { telroiFor } from '~/server/utils/tenant';
export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  const login = getRouterParam(event, 'login')!;
  const client = await telroiFor(s.tenantId);
  return await client.editUser(login, await readBody(event));
});
