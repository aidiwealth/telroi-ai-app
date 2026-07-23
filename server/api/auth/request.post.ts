// POST /api/auth/request  { email, captchaToken? } -> sends magic link + OTP
import { z } from 'zod';
import { startLogin } from '~/server/utils/auth-core';
import { apiError, rateLimit, clientIp } from '~/server/utils/api';
import { verifyCaptcha } from '~/server/utils/captcha';

const Body = z.object({
  email: z.string().email(),
  captchaToken: z.string().optional(),
  // 'signin' means "this person expects an account to exist". We check, and say
  // so plainly rather than mailing a code that leads to an unexpected signup.
  // Anything else keeps the original behaviour: the code creates the account on
  // verification. Note this does reveal whether an address is registered — the
  // per-email and per-IP limits below are what keep that from being enumerable.
  intent: z.enum(['signin', 'signup']).optional()
});

export default defineEventHandler(async (event) => {
  const parsed = Body.safeParse(await readBody(event));
  if (!parsed.success) throw apiError('invalid', 'A valid email is required');

  const email = parsed.data.email.toLowerCase().trim();
  const ip = clientIp(event);

  // Bot gate BEFORE any paid send (email/OTP cost money). Only enforced when a
  // captcha provider is configured; otherwise this is a no-op (dev/local).
  await verifyCaptcha(parsed.data.captchaToken, ip);

  // Per-email: short-window burst limit + a hard daily cap (stops slow pumping).
  rateLimit('auth_request_email', email, 5, 15 * 60 * 1000);
  rateLimit('auth_request_email_day', email, 15, 24 * 60 * 60 * 1000);
  // Per-IP: short-window + daily, to stop an attacker rotating emails on one IP.
  rateLimit('auth_request_ip', ip, 15, 15 * 60 * 1000);
  rateLimit('auth_request_ip_day', ip, 60, 24 * 60 * 60 * 1000);

  if (parsed.data.intent === 'signin') {
    const { useDb, schema } = await import('~/server/db');
    const { eq } = await import('drizzle-orm');
    const [existing] = await useDb().select({ id: schema.users.id })
      .from(schema.users).where(eq(schema.users.email, email)).limit(1);
    if (!existing) {
      console.warn(`[auth] sign-in attempted for unknown email from ${ip}`);
      throw apiError('no_account', 'We could not find an account with that email.', 404);
    }
  }

  await startLogin(email);
  return { ok: true };
});
