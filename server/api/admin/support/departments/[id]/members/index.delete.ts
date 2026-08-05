import { requirePlatformAdmin } from '~/server/utils/platform';
import { ensureSupportWorkspace } from '~/server/utils/support';
import { z } from 'zod';
import { apiError } from '~/server/utils/api';
import { removeDepartmentMember } from '~/server/utils/departments';

const Body = z.object({ userId: z.string().uuid() });

export default defineEventHandler(async (event) => {
  await requirePlatformAdmin(event);
  const id = getRouterParam(event, 'id')!;
  const p = Body.safeParse(await readBody(event));
  if (!p.success) throw apiError('invalid', 'A user is required');
  const ws = await ensureSupportWorkspace();
  await removeDepartmentMember(ws.tenantId, id, p.data.userId);
  return { ok: true };
});
