// GET /widget/config?key=WIDGET_KEY -> public widget config. CORS-open.
import { tenantByWidgetKey, widgetConfig } from '~/server/utils/live-call';
import { ensureGuestEndpoint } from '~/server/utils/widget-guest';
export default defineEventHandler(async (event) => {
  setHeader(event, 'Access-Control-Allow-Origin', '*');
  setHeader(event, 'Cache-Control', 'public, max-age=60');
  const key = String(getQuery(event).key || '');
  let t = null;
  try { t = await tenantByWidgetKey(key); } catch { setResponseStatus(event, 503); return { error: 'unavailable' }; }
  if (!t) { setResponseStatus(event, 404); return { error: 'invalid_key' }; }
  // Only serve when Live Call is enabled for this tenant.
  const { hasFeature } = await import('~/server/utils/entitlements');
  if (!(await hasFeature(t.id, 'crm'))) { setResponseStatus(event, 403); return { error: 'not_enabled' }; }
  // Make sure this tenant has a guest endpoint ready before anyone clicks to
  // call. Provisioning takes the better part of a minute — far too long to do
  // while a visitor waits — but the widget's config is fetched as soon as a page
  // loads, which is early enough to have one waiting. Deliberately not awaited:
  // the config must return now, and a visitor who calls before it finishes will
  // simply provision one the slow way.
  void ensureGuestEndpoint(t.id).catch(() => { /* next page load tries again */ });

  const { geoFromEvent } = await import('~/server/utils/live-call');
  return { ok: true, config: await widgetConfig(t.id, geoFromEvent(event).country) };
});
