import { requireTenant } from '~/server/utils/api';
import { listDepartments } from '~/server/utils/departments';
export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  return { departments: await listDepartments(s.tenantId) };
});
