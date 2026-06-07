import { requirePlatformAdmin } from '~/server/utils/platform';
import { apiError } from '~/server/utils/api';
import { resolveTenantByDomain } from '~/server/utils/resolve-tenant';
import { removeDepartmentMember } from '~/server/utils/departments';
export default defineEventHandler(async (event) => {
  await requirePlatformAdmin(event);
  const t = await resolveTenantByDomain(decodeURIComponent(getRouterParam(event, 'domain')!));
  if (!t) throw apiError('not_found', 'Workspace not found', 404);
  const userId = String(getQuery(event).userId || '');
  if (!userId) throw apiError('invalid', 'A userId is required');
  return await removeDepartmentMember(t.id, getRouterParam(event, 'deptId')!, userId);
});
