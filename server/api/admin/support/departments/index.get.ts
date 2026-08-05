// GET /api/admin/support/departments -> teams on the support desk.
//
// The client endpoint reads the caller's own tenant, which for an admin is their
// workspace or none — so support had no way to see or make teams, and the AI
// could route callers to a department for every client except us.
import { requirePlatformAdmin } from '~/server/utils/platform';
import { ensureSupportWorkspace } from '~/server/utils/support';
import { listDepartments } from '~/server/utils/departments';

export default defineEventHandler(async (event) => {
  await requirePlatformAdmin(event);
  const ws = await ensureSupportWorkspace();
  return { departments: await listDepartments(ws.tenantId) };
});
