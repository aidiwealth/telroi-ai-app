import { requirePlatformAdmin } from '~/server/utils/platform';
import { ensureSupportWorkspace } from '~/server/utils/support';
import { addNote } from '~/server/utils/crm';
export default defineEventHandler(async (event) => {
  const admin = await requirePlatformAdmin(event);
  const ws = await ensureSupportWorkspace();
  const body = await readBody(event);
  const note = await addNote(ws.tenantId, getRouterParam(event, 'id')!, (admin as any).id || ws.tenantId, body?.body || '');
  return { note };
});
