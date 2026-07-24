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
export async function widgetConfig(tenantId: string, visitorCountry?: string | null) {
  const eff = await effectiveSettings(tenantId, 'live_call');
  const s = eff.settings;
  // Which dial code the callback form should preselect. The visitor's own country
  // is the best guess when the edge gives it to us; otherwise the business's, since
  // most of its visitors are local to it.
  let country = (visitorCountry || '').toUpperCase() || null;
  if (!country) {
    try {
      const { useDb, schema } = await import('~/server/db');
      const { eq } = await import('drizzle-orm');
      const [t] = await useDb().select({ country: schema.tenants.country })
        .from(schema.tenants).where(eq(schema.tenants.id, tenantId)).limit(1);
      // country is stored as a name ("Nigeria"), not an ISO code — map it.
      const { countryProfile } = await import('./countries');
      country = t?.country ? (countryProfile(t.country).region || null) : null;
    } catch { /* fall through to the widget's own default */ }
  }
  return {
    bubbleColor: s.bubbleColor, bubblePosition: s.bubblePosition,
    greeting: s.greeting, routeTo: s.routeTo, csatEnabled: s.csatEnabled,
    trackLocation: s.trackLocation, country
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
