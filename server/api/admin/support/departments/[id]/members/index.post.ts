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
  // The team list offers operators, whose ids are platform admin ids — and this
  // column is a foreign key into users. Resolved by email, which also creates
  // the users row for an operator who has never signed in as a client.
  const { userIdForAdmin } = await import('~/server/utils/platform');
  const userId = await userIdForAdmin(p.data.userId) || p.data.userId;

  return { member: await setDepartmentMember(ws.tenantId, id, userId, { canTakeCalls: p.data.canTakeCalls ?? true }) };
});
