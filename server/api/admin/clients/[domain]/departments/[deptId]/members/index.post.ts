import { z } from 'zod';
import { requirePlatformAdmin } from '~/server/utils/platform';
import { apiError } from '~/server/utils/api';
import { resolveTenantByDomain } from '~/server/utils/resolve-tenant';
import { setDepartmentMember } from '~/server/utils/departments';
const Body = z.object({ userId: z.string().uuid(), canMakeCalls: z.boolean().optional(), canTakeCalls: z.boolean().optional(), canOperate: z.boolean().optional() });
export default defineEventHandler(async (event) => {
  await requirePlatformAdmin(event);
  const t = await resolveTenantByDomain(decodeURIComponent(getRouterParam(event, 'domain')!));
  if (!t) throw apiError('not_found', 'Workspace not found', 404);
  const p = Body.safeParse(await readBody(event));
  if (!p.success) throw apiError('invalid', 'A userId is required');
  try { return { member: await setDepartmentMember(t.id, getRouterParam(event, 'deptId')!, p.data.userId, p.data) }; }
  catch (e: any) { throw apiError('invalid', e.message || 'Could not add member', 400); }
});
