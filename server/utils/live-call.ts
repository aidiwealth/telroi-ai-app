// server/utils/live-call.ts — Live Call widget backend helpers.
import { eq } from 'drizzle-orm';
import { useDb, schema } from '../db';
import { effectiveSettings } from './feature-settings';

export async function tenantByWidgetKey(key: string) {
  if (!key) return null;
  const db = useDb();
  const [t] = await db.select().from(schema.tenants).where(eq(schema.tenants.widgetKey, key)).limit(1);
  return t || null;
}

// Public widget config — only what's safe to expose client-side.
export async function widgetConfig(tenantId: string) {
  const eff = await effectiveSettings(tenantId, 'live_call');
  const s = eff.settings;
  return {
    bubbleColor: s.bubbleColor, bubblePosition: s.bubblePosition,
    greeting: s.greeting, routeTo: s.routeTo, csatEnabled: s.csatEnabled,
    trackLocation: s.trackLocation
  };
}

// Coarse geo from request IP via a privacy-respecting lookup. Best-effort; if it
// fails we just store nothing. (Cloudflare/edge headers used first when present.)
export function geoFromEvent(event: any): { country?: string; region?: string; city?: string } {
  const h = (n: string) => getHeader(event, n) || undefined;
  return {
    country: h('cf-ipcountry') || h('x-vercel-ip-country'),
    region: h('x-vercel-ip-country-region'),
    city: h('x-vercel-ip-city') ? decodeURIComponent(h('x-vercel-ip-city')!) : undefined
  };
}
