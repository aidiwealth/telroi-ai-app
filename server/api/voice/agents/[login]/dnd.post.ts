// POST /api/voice/agents/:login/dnd { on: boolean } -> toggle do-not-disturb
import { z } from 'zod';
import { requireTenant, apiError } from '~/server/utils/api';
import { telroiFor } from '~/server/utils/tenant';
const Body = z.object({ on: z.boolean() });
export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  const login = getRouterParam(event, 'login')!;
  const parsed = Body.safeParse(await readBody(event));
  if (!parsed.success) throw apiError('invalid', 'on (boolean) required');
  const client = await telroiFor(s.tenantId);
  await client.setDnd(login, parsed.data.on);
  return { ok: true };
});
