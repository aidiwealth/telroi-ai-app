// POST /api/voice/numbers/:telnum/enabled { enabled: boolean }
import { z } from 'zod';
import { requireTenant, apiError } from '~/server/utils/api';
import { telroiFor } from '~/server/utils/tenant';
const Body = z.object({ enabled: z.boolean() });
export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  const telnum = getRouterParam(event, 'telnum')!;
  const parsed = Body.safeParse(await readBody(event));
  if (!parsed.success) throw apiError('invalid', 'enabled (boolean) required');
  const client = await telroiFor(s.tenantId);
  parsed.data.enabled ? await client.enableNumber(telnum) : await client.disableNumber(telnum);
  return { ok: true };
});
