// composables/useCaptcha.ts
// Loads the configured CAPTCHA widget (Turnstile or reCAPTCHA) on demand and
// exposes the solved token. No-op when login protection is disabled, so login
// pages render normally. The token is sent with the login send request.
import { ref, onMounted } from 'vue';

export function useCaptcha() {
  const enabled = ref(false);
  const provider = ref<'turnstile' | 'recaptcha'>('turnstile');
  const siteKey = ref('');
  const token = ref('');
  const widgetId = ref<any>(null);

  async function init() {
    try {
      const cfg = await $fetch<any>('/api/auth/captcha-config');
      enabled.value = !!cfg.enabled && !!cfg.siteKey;
      provider.value = cfg.provider || 'turnstile';
      siteKey.value = cfg.siteKey || '';
      if (enabled.value) loadScript();
    } catch { enabled.value = false; }
  }

  function loadScript() {
    if (typeof window === 'undefined') return;
    const id = 'captcha-script';
    if (document.getElementById(id)) { renderWhenReady(); return; }
    const s = document.createElement('script');
    s.id = id; s.async = true; s.defer = true;
    s.src = provider.value === 'turnstile'
      ? 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
      : 'https://www.google.com/recaptcha/api.js?render=explicit';
    s.onload = renderWhenReady;
    document.head.appendChild(s);
  }

  function renderWhenReady(attempt = 0) {
    if (typeof window === 'undefined' || attempt > 40) return;
    const el = document.getElementById('captcha-widget');
    const w: any = window as any;
    const lib = provider.value === 'turnstile' ? w.turnstile : w.grecaptcha;
    if (!el || !lib || (provider.value === 'recaptcha' && !lib.render)) {
      setTimeout(() => renderWhenReady(attempt + 1), 150);
      return;
    }
    if (widgetId.value !== null) return; // already rendered
    if (provider.value === 'turnstile') {
      widgetId.value = lib.render(el, { sitekey: siteKey.value, callback: (t: string) => { token.value = t; },
        'expired-callback': () => { token.value = ''; } });
    } else {
      widgetId.value = lib.render(el, { sitekey: siteKey.value, callback: (t: string) => { token.value = t; },
        'expired-callback': () => { token.value = ''; } });
    }
  }

  function reset() {
    token.value = '';
    const w: any = window as any;
    const lib = provider.value === 'turnstile' ? w.turnstile : w.grecaptcha;
    try { if (lib && widgetId.value !== null) lib.reset(widgetId.value); } catch { /* */ }
  }

  onMounted(init);
  return { enabled, provider, siteKey, token, reset };
}
