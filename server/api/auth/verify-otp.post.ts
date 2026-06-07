// POST /api/auth/verify-otp  { email, code } -> session cookie
import { z } from 'zod';
import { verifyOtp, establishSession } from '~/server/utils/auth-core';
import { apiError, rateLimit, clientIp } from '~/server/utils/api';

const Body = z.object({ email: z.string().email(), code: z.string().regex(/^\d{6}$/) });

export default defineEventHandler(async (event) => {
  const parsed = Body.safeParse(await readBody(event));
  if (!parsed.success) throw apiError('invalid', 'Email and 6-digit code required');
  const email = parsed.data.email.toLowerCase().trim();
  // Per-IP and per-EMAIL caps on verification attempts. The per-email cap is the
  // important one: it limits TOTAL guesses across code regenerations, so an
  // attacker can't reset the 5-per-code limit by requesting fresh codes.
  rateLimit('auth_otp_ip', clientIp(event), 30, 15 * 60 * 1000);
  rateLimit('auth_otp_email', email, 10, 15 * 60 * 1000);

  const verified = await verifyOtp(email, parsed.data.code);
  const { hasTenant } = await establishSession(event, verified);
  return { ok: true, hasTenant };
});
