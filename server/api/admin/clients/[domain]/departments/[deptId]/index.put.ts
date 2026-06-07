import { z } from 'zod';
import { requirePlatformAdmin } from '~/server/utils/platform';
import { apiError } from '~/server/utils/api';
import { resolveTenantByDomain } from '~/server/utils/resolve-tenant';
import { updateDepartment } from '~/server/utils/departments';
const Body = z.object({ name: z.string().min(1).max(80).optional(), description: z.string().max(300).optional(), ringStrategy: z.enum(['simultaneous','round_robin','linear']).optional(), ringTimeout: z.number().int().min(5).max(120).optional() });
export default defineEventHandler(async (event) => {
  await requirePlatformAdmin(event);
  const t = await resolveTenantByDomain(decodeURIComponent(getRouterParam(event, 'domain')!));
  if (!t) throw apiError('not_found', 'Workspace not found', 404);
  const p = Body.safeParse(await readBody(event));
  if (!p.success) throw apiError('invalid', 'Invalid update');
  return { department: await updateDepartment(t.id, getRouterParam(event, 'deptId')!, p.data) };
});
