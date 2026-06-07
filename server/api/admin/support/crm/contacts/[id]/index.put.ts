import { requirePlatformAdmin } from '~/server/utils/platform';
import { ensureSupportWorkspace } from '~/server/utils/support';
import { updateContact } from '~/server/utils/crm';
export default defineEventHandler(async (event) => {
  await requirePlatformAdmin(event);
  const ws = await ensureSupportWorkspace();
  const body = await readBody(event);
  const contact = await updateContact(ws.tenantId, getRouterParam(event, 'id')!, body || {});
  return { contact };
});
