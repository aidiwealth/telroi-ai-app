import { requireApiKey, hasScope } from '~/server/utils/apikey-auth';
import { apiError } from '~/server/utils/api';
import { telroiFor } from '~/server/utils/tenant';
export default defineEventHandler(async (event) => {
  const ctx = await requireApiKey(event);
  if (!hasScope(ctx, 'agents:read')) throw apiError('forbidden', 'Key lacks agents:read', 403);
  const client = await telroiFor(ctx.tenantId);
  const r = await client.listUsers(getQuery(event));
  return { object: 'list', data: r.items || [] };
});
