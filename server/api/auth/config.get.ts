// GET /api/auth/config -> what a client needs before showing a sign-in form.
//
// Unauthenticated by necessity: it is read before anybody has a session. It
// returns no secrets — a Turnstile site key is public and appears in the web
// app's own page source.
//
// This exists because captcha can be switched off in admin settings. A mobile
// app that assumed it was always on would block its own sign-in button waiting
// for a token nobody was going to check.
import { platformSettings } from '~/server/utils/platform';

export default defineEventHandler(async () => {
  const cfg = useRuntimeConfig() as any;
  const settings = await platformSettings().catch(() => null);

  const provider = (settings?.captchaProvider as string) || (cfg.captchaProvider as string) || 'turnstile';
  // Mirrors verifyCaptcha: configured secret, or the admin toggle.
  const enabled = !!(cfg.captchaSecret) || !!(settings as any)?.captchaEnabled;

  return {
    captcha: {
      enabled,
      provider,
      // Web and mobile need different Turnstile widgets, so the server says
      // which key belongs to the caller rather than the app hardcoding one.
      siteKey: ((settings as any)?.captchaSiteKey as string)
        || ((cfg.public as any)?.captchaSiteKey as string) || null,
      mobileSiteKey: (cfg.captchaMobileSiteKey as string) || null,
    },
  };
});
