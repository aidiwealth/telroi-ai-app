import { z } from 'zod';
import { requireTenantManager, apiError } from '~/server/utils/api';
import { setDepartmentMember } from '~/server/utils/departments';
const Body = z.object({
  userId: z.string().uuid(),
  canMakeCalls: z.boolean().optional(),
  canTakeCalls: z.boolean().optional(),
  canOperate: z.boolean().optional()
});
export default defineEventHandler(async (event) => {
  const s = await requireTenantManager(event);
  const departmentId = getRouterParam(event, 'id')!;
  const p = Body.safeParse(await readBody(event));
  if (!p.success) throw apiError('invalid', 'A userId is required');
  try {
    return { member: await setDepartmentMember(s.tenantId, departmentId, p.data.userId, p.data) };
  } catch (e: any) { throw apiError('invalid', e.message || 'Could not add member', 400); }
});
