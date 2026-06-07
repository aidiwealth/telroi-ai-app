import { requireTenant } from '~/server/utils/api';
import { telroiFor } from '~/server/utils/tenant';
export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  const client = await telroiFor(s.tenantId);
  return await client.listNumbers(getQuery(event));
});
