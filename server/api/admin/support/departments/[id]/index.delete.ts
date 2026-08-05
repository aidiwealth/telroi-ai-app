import { requirePlatformAdmin } from '~/server/utils/platform';
import { ensureSupportWorkspace } from '~/server/utils/support';
import { deleteDepartment } from '~/server/utils/departments';

export default defineEventHandler(async (event) => {
  await requirePlatformAdmin(event);
  const id = getRouterParam(event, 'id')!;
  const ws = await ensureSupportWorkspace();
  await deleteDepartment(ws.tenantId, id);
  return { ok: true };
});
