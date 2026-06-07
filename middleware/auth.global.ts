// Global route guard.
//  - Unauthenticated users -> /login (the sign-in box)
//  - Authenticated users whose workspace setup isn't finished -> /onboarding
//    (the real onboarding wizard)
//  - Authenticated + finished users sitting on /login or /onboarding -> dashboard
import { useAuthStore } from '~/stores/auth';

export default defineNuxtRouteMiddleware(async (to) => {
  // The /admin area has its own platform-admin auth; skip the tenant guard.
  if (to.path.startsWith('/admin')) return;

  // Public, external-facing pages that must work signed-out (the API docs are
  // for third-party developers who don't have a Telroi login).
  if (to.path === '/api/docs' || to.path.startsWith('/api/docs')) return;
  if (to.path === '/status' || to.path.startsWith('/status')) return;

  const auth = useAuthStore();
  if (!auth.loaded) await auth.fetchMe();

  const isLogin = to.path === '/login' || to.path.startsWith('/login');
  const isOnboarding = to.path === '/onboarding' || to.path.startsWith('/onboarding');

  // Not signed in -> the login page (allow the login page itself through).
  if (!auth.isAuthed) {
    return isLogin ? undefined : navigateTo('/login');
  }

  // Signed in but workspace setup incomplete -> the onboarding wizard
  // (allow the wizard itself through to avoid a redirect loop).
  if (auth.needsOnboarding && !isOnboarding) {
    return navigateTo('/onboarding');
  }

  // Signed in + finished, but sitting on an entry page -> dashboard.
  if (auth.isAuthed && !auth.needsOnboarding && (isLogin || isOnboarding)) {
    return navigateTo('/');
  }
});
