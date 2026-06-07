import { z } from 'zod';
import { requirePlatformAdmin } from '~/server/utils/platform';
import { apiError } from '~/server/utils/api';
import { resolveTenantByDomain } from '~/server/utils/resolve-tenant';
import { createDepartment } from '~/server/utils/departments';
const Body = z.object({ name: z.string().min(1).max(80), description: z.string().max(300).optional() });
export default defineEventHandler(async (event) => {
  await requirePlatformAdmin(event);
  const t = await resolveTenantByDomain(decodeURIComponent(getRouterParam(event, 'domain')!));
  if (!t) throw apiError('not_found', 'Workspace not found', 404);
  const p = Body.safeParse(await readBody(event));
  if (!p.success) throw apiError('invalid', 'A team name is required');
  return { department: await createDepartment(t.id, p.data.name, p.data.description) };
});
