// DELETE /api/voice/agents/:login
import { requireTenant } from '~/server/utils/api';
import { telroiFor } from '~/server/utils/tenant';
export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  const login = getRouterParam(event, 'login')!;
  const client = await telroiFor(s.tenantId);
  await client.deleteUser(login);
  return { ok: true };
});
