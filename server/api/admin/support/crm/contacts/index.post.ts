import { requirePlatformAdmin } from '~/server/utils/platform';
import { ensureSupportWorkspace } from '~/server/utils/support';
import { createContact } from '~/server/utils/crm';
export default defineEventHandler(async (event) => {
  await requirePlatformAdmin(event);
  const ws = await ensureSupportWorkspace();
  const body = await readBody(event);
  const contact = await createContact(ws.tenantId, body || {});
  return { contact };
});
