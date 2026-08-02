import { requirePlatformAdmin } from '~/server/utils/platform';
import { ensureSupportWorkspace } from '~/server/utils/support';
import { apiError } from '~/server/utils/api';
import { getContact } from '~/server/utils/crm';
export default defineEventHandler(async (event) => {
  await requirePlatformAdmin(event);
  const ws = await ensureSupportWorkspace();
  const contact = await getContact(ws.tenantId, getRouterParam(event, 'id')!);
  // A missing contact came back as { contact: undefined }, so the page rendered
  // empty rather than saying it wasn't there.
  if (!contact) throw apiError('not_found', 'Contact not found', 404);
  return { contact };
});
