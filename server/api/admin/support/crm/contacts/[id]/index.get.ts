import { requirePlatformAdmin } from '~/server/utils/platform';
import { ensureSupportWorkspace } from '~/server/utils/support';
import { getContact } from '~/server/utils/crm';
export default defineEventHandler(async (event) => {
  await requirePlatformAdmin(event);
  const ws = await ensureSupportWorkspace();
  const contact = await getContact(ws.tenantId, getRouterParam(event, 'id')!);
  return { contact };
});
