import { requireApiKey, hasScope } from '~/server/utils/apikey-auth';
import { apiError } from '~/server/utils/api';
import { telroiFor } from '~/server/utils/tenant';
export default defineEventHandler(async (event) => {
  const ctx = await requireApiKey(event);
  if (!hasScope(ctx, 'numbers:read')) throw apiError('forbidden', 'Key lacks numbers:read', 403);
  const client = await telroiFor(ctx.tenantId);
  const r = await client.listNumbers(getQuery(event));
  return { object: 'list', data: r.items || [] };
});
