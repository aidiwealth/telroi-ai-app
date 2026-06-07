// POST /v1/calls { phone, user } -> originate an outbound call
import { z } from 'zod';
import { requireApiKey, hasScope } from '~/server/utils/apikey-auth';
import { apiError } from '~/server/utils/api';
import { telroiFor } from '~/server/utils/tenant';
const Body = z.object({ phone: z.string().min(3), from: z.string().optional(), user: z.string().optional(), group: z.string().optional() });
export default defineEventHandler(async (event) => {
  const ctx = await requireApiKey(event);
  if (!hasScope(ctx, 'calls:write')) throw apiError('forbidden', 'Key lacks calls:write', 403);
  const p = Body.safeParse(await readBody(event));
  if (!p.success) throw apiError('invalid', 'phone is required');

  // Sandbox: a test key never touches the real PBX or wallet. Return a
  // realistic simulated call so developers can build & test safely.
  if (ctx.env === 'sandbox') {
    return {
      object: 'call', simulated: true, livemode: false,
      id: `call_test_${Math.random().toString(36).slice(2, 12)}`,
      phone: p.data.phone, from: p.data.from || null,
      status: 'queued', created: new Date().toISOString()
    };
  }

  // Route by the from-number's provisioned carrier when given.
  if (p.data.from) {
    const { placeCall } = await import('~/server/utils/call-router');
    const res = await placeCall({ tenantId: ctx.tenantId, fromTelnum: p.data.from, to: p.data.phone, user: p.data.user, group: p.data.group });
    return { object: 'call', livemode: true, ...res };
  }
  const client = await telroiFor(ctx.tenantId);
  const res = await client.makeCall({ phone: p.data.phone, user: p.data.user, group: p.data.group });
  return { object: 'call', livemode: true, ...res };
});
