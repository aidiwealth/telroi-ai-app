// DELETE /api/admin/support/crm/contacts/:id -> remove a support contact.
//
// The client side has had this; the operator side had no way to remove anything
// at all. Soft, like the client's: the notes and call history record a real
// conversation, and a hard delete would not stick anyway — the call sync
// recreates a contact the next time that number rings.
import { requirePlatformAdmin } from '~/server/utils/platform';
import { ensureSupportWorkspace } from '~/server/utils/support';
import { deleteContact } from '~/server/utils/crm';

export default defineEventHandler(async (event) => {
  await requirePlatformAdmin(event);
  const ws = await ensureSupportWorkspace();
  return await deleteContact(ws.tenantId, getRouterParam(event, 'id')!);
});
