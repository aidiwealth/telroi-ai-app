// Universal auth hydration. Runs once on app init on BOTH server and client.
// On the server it forwards the request cookie; on the client the browser sends
// it automatically. This guarantees the auth store is populated before route
// middleware evaluates, eliminating the post-login race that could bounce a
// fully-onboarded user to /onboarding.
import { useAuthStore } from '~/stores/auth';

export default defineNuxtPlugin(async () => {
  const auth = useAuthStore();
  if (auth.loaded) return;
  try {
    const headers = import.meta.server ? useRequestHeaders(['cookie']) : undefined;
    const data = await $fetch<{ user: any; tenant: any }>('/api/auth/me', headers ? { headers } : {});
    // Plain-prototype copies: a null-prototype object crashes Pinia's
    // shouldHydrate during SSR payload serialization (notably on the error page).
    // Deep plain-prototype copies. A shallow spread leaves nested null-prototype
    // objects, which crash Pinia's shouldHydrate ('hasOwnProperty is not a
    // function') during SSR payload serialization — notably when rendering the
    // 404/error page for scanner probes like /admin/.env. JSON round-trip
    // guarantees every level has Object.prototype.
    auth.user = data.user ? JSON.parse(JSON.stringify(data.user)) : null;
    auth.tenant = data.tenant ? JSON.parse(JSON.stringify(data.tenant)) : null;
  } catch {
    auth.user = null;
    auth.tenant = null;
  } finally {
    auth.loaded = true;
  }
});
