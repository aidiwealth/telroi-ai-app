// GET /widget/config?key=WIDGET_KEY -> public widget config. CORS-open.
import { tenantByWidgetKey, widgetConfig } from '~/server/utils/live-call';
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
  const { geoFromEvent } = await import('~/server/utils/live-call');
  return { ok: true, config: await widgetConfig(t.id, geoFromEvent(event).country) };
});
