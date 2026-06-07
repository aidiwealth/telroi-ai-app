import { z } from 'zod';
import { requireTenantManager, apiError } from '~/server/utils/api';
import { createDepartment } from '~/server/utils/departments';
const Body = z.object({ name: z.string().min(1).max(80), description: z.string().max(300).optional() });
export default defineEventHandler(async (event) => {
  const s = await requireTenantManager(event);
  const p = Body.safeParse(await readBody(event));
  if (!p.success) throw apiError('invalid', 'A team name is required');
  return { department: await createDepartment(s.tenantId, p.data.name, p.data.description) };
});
