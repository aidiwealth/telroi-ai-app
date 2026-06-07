import { z } from 'zod';
import { requireTenantManager, apiError } from '~/server/utils/api';
import { assignNumberToDepartment } from '~/server/utils/departments';
const Body = z.object({ subscriptionId: z.string().uuid(), departmentId: z.string().uuid().nullable() });
export default defineEventHandler(async (event) => {
  const s = await requireTenantManager(event);
  const p = Body.safeParse(await readBody(event));
  if (!p.success) throw apiError('invalid', 'subscriptionId and departmentId required');
  try {
    return { number: await assignNumberToDepartment(s.tenantId, p.data.subscriptionId, p.data.departmentId) };
  } catch (e: any) { throw apiError('invalid', e.message || 'Could not assign', 400); }
});
