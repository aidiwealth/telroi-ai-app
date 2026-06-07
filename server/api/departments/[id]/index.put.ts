import { z } from 'zod';
import { requireTenantManager, apiError } from '~/server/utils/api';
import { updateDepartment } from '~/server/utils/departments';
const Body = z.object({ name: z.string().min(1).max(80).optional(), description: z.string().max(300).optional(), ringStrategy: z.enum(['simultaneous','round_robin','linear']).optional(), ringTimeout: z.number().int().min(5).max(120).optional() });
export default defineEventHandler(async (event) => {
  const s = await requireTenantManager(event);
  const id = getRouterParam(event, 'id')!;
  const p = Body.safeParse(await readBody(event));
  if (!p.success) throw apiError('invalid', 'Invalid update');
  return { department: await updateDepartment(s.tenantId, id, p.data) };
});
