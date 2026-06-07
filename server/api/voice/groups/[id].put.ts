import { requireTenant } from '~/server/utils/api';
import { telroiFor } from '~/server/utils/tenant';
export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  const id = getRouterParam(event, 'id')!;
  const client = await telroiFor(s.tenantId);
  return await client.editGroup(id, await readBody(event));
});
