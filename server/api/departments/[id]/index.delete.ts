import { requireTenantManager } from '~/server/utils/api';
import { deleteDepartment } from '~/server/utils/departments';
export default defineEventHandler(async (event) => {
  const s = await requireTenantManager(event);
  const id = getRouterParam(event, 'id')!;
  return await deleteDepartment(s.tenantId, id);
});
