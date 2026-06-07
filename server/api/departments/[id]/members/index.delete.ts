import { requireTenantManager, apiError } from '~/server/utils/api';
import { removeDepartmentMember } from '~/server/utils/departments';
export default defineEventHandler(async (event) => {
  const s = await requireTenantManager(event);
  const departmentId = getRouterParam(event, 'id')!;
  const userId = String(getQuery(event).userId || '');
  if (!userId) throw apiError('invalid', 'A userId is required');
  return await removeDepartmentMember(s.tenantId, departmentId, userId);
});
