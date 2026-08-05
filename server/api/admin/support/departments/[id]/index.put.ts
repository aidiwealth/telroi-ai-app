import { requirePlatformAdmin } from '~/server/utils/platform';
import { ensureSupportWorkspace } from '~/server/utils/support';
import { z } from 'zod';
import { apiError } from '~/server/utils/api';
import { updateDepartment } from '~/server/utils/departments';

const Body = z.object({ name: z.string().min(1).max(80).optional(), description: z.string().max(300).optional(), ringStrategy: z.enum(['simultaneous','round_robin','linear']).optional(), ringTimeout: z.number().int().min(5).max(120).optional() });

export default defineEventHandler(async (event) => {
  await requirePlatformAdmin(event);
  const id = getRouterParam(event, 'id')!;
  const p = Body.safeParse(await readBody(event));
  if (!p.success) throw apiError('invalid', 'Invalid update');
  const ws = await ensureSupportWorkspace();
  return { department: await updateDepartment(ws.tenantId, id, p.data) };
});
