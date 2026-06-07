// GET /api/auth/captcha-config -> PUBLIC: tells the login page whether to show
// a captcha widget, the provider, and the PUBLIC site key. Never exposes the
// secret. Safe to call unauthenticated.
import { platformSettings } from '~/server/utils/platform';
import { useRuntimeConfig } from '#imports';

export default defineEventHandler(async () => {
  const cfg = useRuntimeConfig() as any;
  const hasSecret = !!cfg.captchaSecret;
  try {
    const s = await platformSettings();
    const enabled = !!(s?.captchaEnabled && hasSecret);
    return {
      enabled,
      provider: (s?.captchaProvider as string) || 'turnstile',
      siteKey: enabled ? (s?.captchaSiteKey || cfg.public.captchaSiteKey || '') : ''
    };
  } catch {
    return { enabled: false, provider: 'turnstile', siteKey: '' };
  }
});
