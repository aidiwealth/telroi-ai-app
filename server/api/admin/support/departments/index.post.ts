// POST /api/admin/support/departments { name, description? } -> create a team
// on the support desk. Mirrors the client endpoint; the description matters more
// than it looks, since it's what the AI reads when deciding where to send a
// caller who described a problem rather than naming a team.
import { z } from 'zod';
import { requirePlatformAdmin } from '~/server/utils/platform';
import { ensureSupportWorkspace } from '~/server/utils/support';
import { createDepartment } from '~/server/utils/departments';
import { apiError } from '~/server/utils/api';

const Body = z.object({ name: z.string().min(1).max(80), description: z.string().max(300).optional() });

export default defineEventHandler(async (event) => {
  await requirePlatformAdmin(event);
  const p = Body.safeParse(await readBody(event));
  if (!p.success) throw apiError('invalid', 'A team name is required');
  const ws = await ensureSupportWorkspace();
  return { department: await createDepartment(ws.tenantId, p.data.name, p.data.description) };
});
