// POST /v1/otp/verify { id?, to?, code } -> verify a code the end-user entered.
import { z } from 'zod';
import { requireApiKey, hasScope } from '~/server/utils/apikey-auth';
import { apiError } from '~/server/utils/api';
const Body = z.object({ id: z.string().uuid().optional(), to: z.string().optional(), code: z.string().min(4).max(10) });
export default defineEventHandler(async (event) => {
  const ctx = await requireApiKey(event);
  if (!hasScope(ctx, 'otp:write')) throw apiError('forbidden', 'Key lacks otp:write', 403);
  const p = Body.safeParse(await readBody(event));
  if (!p.success || (!p.data.id && !p.data.to)) throw apiError('invalid', 'code and one of id|to are required');

  if (ctx.env === 'sandbox') {
    const ok = p.data.code === '000000';
    return { object: 'otp_verification', simulated: true, livemode: false, status: ok ? 'verified' : 'mismatch', verified: ok };
  }

  const { verifyVoiceOtp } = await import('~/server/utils/voice/otp-service');
  const r = await verifyVoiceOtp(ctx.tenantId, { id: p.data.id, toNumber: p.data.to }, p.data.code);
  return { object: 'otp_verification', livemode: true, status: r.status, verified: r.ok, attempts_left: r.attemptsLeft };
});
