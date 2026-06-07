// POST /api/voice/charge { callId, seconds, provider } -> meter + charge a
// completed in-browser call to the tenant's wallet. Idempotent per callId.
import { z } from 'zod';
import { requireTenant } from '~/server/utils/api';
import { chargeCall } from '~/server/utils/call-billing';
const Body = z.object({ callId: z.string().min(1), seconds: z.number().int().min(0), provider: z.string().optional() });
export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  const p = Body.safeParse(await readBody(event));
  if (!p.success) return { charged: 0, error: 'invalid' };
  return await chargeCall({ tenantId: s.tenantId, callId: p.data.callId, seconds: p.data.seconds, provider: p.data.provider, source: 'dialer' });
});
