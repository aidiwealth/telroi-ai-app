import { z } from 'zod';
import { requirePlatformAdmin } from '~/server/utils/platform';
import { apiError } from '~/server/utils/api';
import { resolveTenantByDomain } from '~/server/utils/resolve-tenant';
import { assignNumberToDepartment } from '~/server/utils/departments';
const Body = z.object({ subscriptionId: z.string().uuid(), departmentId: z.string().uuid().nullable() });
export default defineEventHandler(async (event) => {
  await requirePlatformAdmin(event);
  const t = await resolveTenantByDomain(decodeURIComponent(getRouterParam(event, 'domain')!));
  if (!t) throw apiError('not_found', 'Workspace not found', 404);
  const p = Body.safeParse(await readBody(event));
  if (!p.success) throw apiError('invalid', 'subscriptionId and departmentId required');
  try { return { number: await assignNumberToDepartment(t.id, p.data.subscriptionId, p.data.departmentId) }; }
  catch (e: any) { throw apiError('invalid', e.message || 'Could not assign', 400); }
});
