// GET /v1/calls?period=&limit= -> call history for the authenticated tenant
import { requireApiKey, hasScope } from '~/server/utils/apikey-auth';
import { apiError } from '~/server/utils/api';
import { telroiFor } from '~/server/utils/tenant';
export default defineEventHandler(async (event) => {
  const ctx = await requireApiKey(event);
  if (!hasScope(ctx, 'calls:read')) throw apiError('forbidden', 'Key lacks calls:read', 403);
  const q = getQuery(event);
  const client = await telroiFor(ctx.tenantId);
  const calls = await client.historyJson({ period: q.period || 'month', limit: q.limit || 100, processMissed: true });
  return { object: 'list', data: calls };
});
