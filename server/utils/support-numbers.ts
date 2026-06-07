// server/utils/support-numbers.ts
// Resolves the Telroi Support caller-ID number to use for a given caller region,
// and lists the numbers the support workspace can be assigned. Admin sets a
// default support number per region in Settings; everything admin-side (support
// Live Call routing, admin VANs, admin dialer) reads from here so there is ONE
// source of truth keyed by the auto-detected country.
import { eq, or } from 'drizzle-orm';
import { useDb, schema } from '../db';
import { platformSettings } from './platform';
import { ensureSupportWorkspace } from './support';
import { isNigeria } from './countries';

const NG_PROVIDERS = ['telroi', 'sotel'];

// Region bucket for support routing: Nigeria vs International.
export function supportRegionFor(country?: string | null): 'NG' | 'INTL' {
  return isNigeria(country) ? 'NG' : 'INTL';
}

// The configured default support number for a caller's region, with fallbacks:
//   region map -> legacy supportTelnum -> first provisioned support number in region.
export async function supportNumberForCountry(country?: string | null): Promise<string | null> {
  const s = await platformSettings();
  const region = supportRegionFor(country);
  const map = (s?.supportNumbersByRegion || {}) as { NG?: string; INTL?: string };
  if (map[region]) return map[region]!;
  // Legacy single field counts as the NG/default number.
  if (region === 'NG' && s?.supportTelnum) return s.supportTelnum;
  // Fallback: first provisioned support number whose carrier matches the region.
  const nums = await assignableSupportNumbers();
  const match = nums.find((n) => region === 'NG' ? NG_PROVIDERS.includes(n.provider) : !NG_PROVIDERS.includes(n.provider));
  return match?.telnum || null;
}

// Numbers the support workspace can use: its own subscriptions + assignable
// inventory numbers on Telroi's carriers (not sold to a client).
export async function assignableSupportNumbers(): Promise<{ telnum: string; region: string; provider: string; source: string }[]> {
  const db = useDb();
  const ws = await ensureSupportWorkspace();
  const subs = await db.select().from(schema.numberSubscriptions).where(eq(schema.numberSubscriptions.tenantId, ws.tenantId));
  const inv = await db.select().from(schema.numberInventory);
  const seen = new Set<string>();
  const out: { telnum: string; region: string; provider: string; source: string }[] = [];
  for (const s of subs) { if (!seen.has(s.telnum)) { seen.add(s.telnum); out.push({ telnum: s.telnum, region: s.region, provider: s.provider, source: 'subscription' }); } }
  for (const i of inv) {
    const assignable = i.status !== 'sold' || i.soldToTenantId === ws.tenantId;
    if (assignable && !seen.has(i.telnum)) { seen.add(i.telnum); out.push({ telnum: i.telnum, region: i.region, provider: i.provider, source: 'inventory' }); }
  }
  return out;
}
