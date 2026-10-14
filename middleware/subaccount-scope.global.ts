// When a sub-account is the active reporting lens, keep navigation inside the
// four allowed pages. The active sub-account lives in the tlr_sa cookie
// (set by useActiveSubAccount); this runs on both SSR and client navigations.
export default defineNuxtRouteMiddleware((to) => {
  let id: string | null = null;
  try {
    const v = useCookie<any>('tlr_sa').value;
    if (v && typeof v === 'object') id = v.id || null;
    else if (v) id = JSON.parse(decodeURIComponent(String(v)))?.id || null;
  } catch { id = null; }
  if (!id) return;
  if (!isSubaccountAllowed(to.path)) return navigateTo('/');
});
