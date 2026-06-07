// GET /api/admin/clients/:domain/session -> login link into that client's UI
import { requirePlatformAdmin } from '~/server/utils/platform';
import { OperatorClient } from '~/server/utils/telroi/operator';
export default defineEventHandler(async (event) => {
  await requirePlatformAdmin(event);
  const domain = getRouterParam(event, 'domain')!;
  const op = await OperatorClient.fromPlatform();
  return await op.domainSession(domain);
});
