import { requirePlatformAdmin } from '~/server/utils/platform';
import { ensureSupportWorkspace } from '~/server/utils/support';
import { z } from 'zod';
import { apiError } from '~/server/utils/api';
import { setDepartmentMember } from '~/server/utils/departments';

const Body = z.object({ userId: z.string().uuid(), canTakeCalls: z.boolean().optional() });

export default defineEventHandler(async (event) => {
  await requirePlatformAdmin(event);
  const id = getRouterParam(event, 'id')!;
  const p = Body.safeParse(await readBody(event));
  if (!p.success) throw apiError('invalid', 'A user is required');
  const ws = await ensureSupportWorkspace();
  return { member: await setDepartmentMember(ws.tenantId, id, p.data.userId, { canTakeCalls: p.data.canTakeCalls ?? true }) };
});
