// middleware/superadmin.ts — page guard for superadmin-only areas (App releases,
// Settings, Pricing, Audit). Staff are redirected to the admin home. Server
// endpoints enforce this too; this just prevents staff from loading the page.
export default defineNuxtRouteMiddleware(async () => {
  if (import.meta.server) return; // role check runs client-side via /api/admin/me
  try {
    const r = await $fetch<any>('/api/admin/me');
    if (r?.admin?.role !== 'superadmin') return navigateTo('/admin');
  } catch {
    return navigateTo('/admin');
  }
});
