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

  // A page opened by the guided tour. It renders its own layout with fixture
  // data and never queries a workspace, so a signed-out viewer sees the shape of
  // the product rather than a sign-in box in every frame. Nothing real is
  // reachable this way: the endpoints answer ?demo=1 with a constant.
  // Only the pages the tour frames, and only with the flag. Allowing ?demo=1
  // on any path would have made every screen in the product reachable
  // signed-out as an empty shell, which is a larger thing than showing a tour.
  const TOUR_PAGES = ['/', '/login', '/wallet', '/numbers', '/calls', '/crm',
    '/people', '/teams', '/vans', '/ai', '/connect', '/live-call', '/apps',
    '/settings'];
  if (String(to.query.demo || '') === '1' && TOUR_PAGES.includes(to.path)) return;

  // The guided tour itself, for the same reason: it holds fixtures and the same
  // claims the marketing site makes publicly, so a login on it protects nothing
  // while keeping it from the two audiences it exists for — a prospect
  // evaluating us, and an admin showing them.
  if (to.path === '/guide' || to.path.startsWith('/guide')) return;

  // The chat page, for the widget inside a WebView. It holds nothing: the app
  // passes who the person is, and requiring a session would mean the WebView
  // carrying our cookies for no more safety than we already have.
  if (to.path === '/chat') return;
  // The mobile walkthrough, for the same reason: every screen in it is an
  // imaginary workspace, so there is nothing behind a login to protect.
  if (to.path === '/mobile-guide' || to.path.startsWith('/mobile-guide')) return;

  const auth = useAuthStore();
  if (!auth.loaded) await auth.fetchMe();

  const isLogin = to.path === '/login' || to.path.startsWith('/login');
  const isOnboarding = to.path === '/onboarding' || to.path.startsWith('/onboarding');
  // The guided tour. It reads fixtures rather than a workspace, so it needs a
  // signed-in user but not a finished one — which is what lets a platform admin
  // with no workspace of their own open it to show somebody.
  const isGuide = to.path === '/guide' || to.path.startsWith('/guide');

  // Not signed in -> the login page (allow the login page itself through).
  if (!auth.isAuthed) {
    return isLogin ? undefined : navigateTo('/login');
  }

  // Signed in but workspace setup incomplete -> the onboarding wizard
  // (allow the wizard itself through to avoid a redirect loop).
  if (auth.needsOnboarding && !isOnboarding && !isGuide) {
    return navigateTo('/onboarding');
  }

  // Signed in + finished, but sitting on an entry page -> dashboard.
  if (auth.isAuthed && !auth.needsOnboarding && (isLogin || isOnboarding)) {
    return navigateTo('/');
  }
});
