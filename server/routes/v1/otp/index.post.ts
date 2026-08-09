// POST /v1/otp { to, code_length?, language? } -> place a voice call that reads
// a one-time code aloud. OTP-ONLY. Length is bounded by the operator policy.
import { z } from 'zod';
import { requireApiKey, hasScope } from '~/server/utils/apikey-auth';
import { apiError } from '~/server/utils/api';
const Body = z.object({
  to: z.string().min(3),
  code_length: z.number().int().min(4).max(10).optional(),
  language: z.string().optional(),
  // Your own code, if you already generate them. We read it out and record the
  // call; verifying it stays with you, since we never hold it in a form we
  // could check against.
  code: z.string().regex(/^[0-9]{4,10}$/, 'code must be 4 to 10 digits').optional()
});
export default defineEventHandler(async (event) => {
  const ctx = await requireApiKey(event);
  if (!hasScope(ctx, 'otp:write')) throw apiError('forbidden', 'Key lacks otp:write', 403);
  const p = Body.safeParse(await readBody(event));
  if (!p.success) throw apiError('invalid', 'to (E.164 destination) is required');

  if (ctx.env === 'sandbox') {
    // Test keys never place a real call. Return a realistic object; code 000000
    // verifies in sandbox so developers can build the full flow.
    return { object: 'otp', simulated: true, livemode: false, id: `otp_test_${Math.random().toString(36).slice(2, 12)}`, to: p.data.to, status: 'delivered', expires_in: 300, sandbox_code: '000000' };
  }

  const { sendVoiceOtp } = await import('~/server/utils/voice/otp-service');
  const r = await sendVoiceOtp(ctx.tenantId, p.data.to, { codeLength: p.data.code_length, language: p.data.language, ownCode: p.data.code });
  if (!r.ok) {
    if (r.error?.startsWith('rate_limited')) throw apiError('rate_limited', `Too many requests for this number. Retry after ${r.retryAfterSeconds || 60}s.`, 429);
    throw apiError('otp_failed', r.error || 'Could not place the OTP call', 502);
  }
  // No expires_at when the code is yours: how long it stays valid is your
  // decision, and inventing one here would be us describing a rule we don't
  // enforce.
  return p.data.code
    ? { object: 'otp', livemode: true, id: r.id, to: p.data.to, status: r.status, verification: 'client' }
    : { object: 'otp', livemode: true, id: r.id, to: p.data.to, status: r.status, expires_at: r.expiresAt };
});
