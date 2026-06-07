// server/utils/captcha.ts
// Bot-gate for the login SEND endpoint, where each request triggers a paid
// email/OTP. Supports Cloudflare Turnstile (recommended — free) or Google
// reCAPTCHA. The toggle + provider + PUBLIC site key are operator-controlled in
// admin Settings; the SECRET key lives in env (CAPTCHA_SECRET) and is never
// stored in the DB. The gate is only enforced when BOTH are present: the
// operator has enabled it AND a secret is configured in the environment.
import { apiError } from './api';
import { platformSettings } from './platform';

const VERIFY_URL: Record<string, string> = {
  turnstile: 'https://challenges.cloudflare.com/turnstile/v0/siteverify',
  recaptcha: 'https://www.google.com/recaptcha/api/siteverify'
};

/** Throws 400 if a captcha is required and the token is missing/invalid. No-op when disabled/unconfigured. */
export async function verifyCaptcha(token: string | undefined, ip?: string): Promise<void> {
  const cfg = useRuntimeConfig() as any;
  // Secret is env-only (never in DB). Env can also force a provider override.
  const secret = cfg.captchaSecret as string | undefined;

  // Operator toggle + provider come from platform settings.
  let enabled = false;
  let provider = (cfg.captchaProvider as string) || 'turnstile';
  try {
    const s = await platformSettings();
    if (s?.captchaEnabled) enabled = true;
    if (s?.captchaProvider) provider = s.captchaProvider as string;
  } catch { /* settings unavailable — treat as disabled */ }

  // Enforced only when the operator enabled it AND a secret exists in env.
  if (!enabled || !secret) return;

  if (!token) throw apiError('captcha_required', 'Please complete the verification challenge.', 400);

  const url = VERIFY_URL[provider];
  if (!url) return; // unknown provider — fail open to avoid lockout

  try {
    const form = new URLSearchParams();
    form.set('secret', secret);
    form.set('response', token);
    if (ip) form.set('remoteip', ip);
    const res = await $fetch<any>(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString()
    });
    if (!res?.success) {
      throw apiError('captcha_failed', 'Verification failed. Please try again.', 400);
    }
  } catch (e: any) {
    // If the verification service itself errors, don't hard-lock legitimate
    // users out — the rate limits remain the backstop. Re-throw only our own
    // explicit captcha errors.
    if (e?.data?.error?.code === 'captcha_failed') throw e;
    return;
  }
}
