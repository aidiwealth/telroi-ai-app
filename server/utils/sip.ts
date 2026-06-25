// server/utils/sip.ts
// Resolves which SIP vendors a given client may use. The rule you set:
//   available = (vendors allowed for the client's REGION)   ← from country
//             ∩ (vendors the PLATFORM actually has credentials for)
//   with an ADMIN OVERRIDE that wins when present (admin explicitly sets the
//   list for that client). Region narrows by default; the override is the final
//   say only when an operator has chosen to set it.
import { eq } from 'drizzle-orm';
import { useDb, schema } from '../db';
import { masterCarrierCreds } from './platform';
import { detectRegion, providersForRegion, countryToRegion } from './regions';

export interface SipVendor { id: string; label: string; }

const LABELS: Record<string, string> = {
  telroi: 'Telroi Voice', twilio: 'Twilio', telnyx: 'Telnyx', asterisk: 'Telroi Voice'
};

/** Which SIP vendors this tenant may use, after region + credential + override gating. */
export async function availableSipVendors(tenantId: string): Promise<{ vendors: SipVendor[]; region: string; overridden: boolean }> {
  const db = useDb();
  const [tenant] = await db.select().from(schema.tenants).where(eq(schema.tenants.id, tenantId)).limit(1);
  if (!tenant) return { vendors: [], region: 'NG', overridden: false };

  // Region from the client's country (fallback NG, matching regions.ts default).
  const region = countryToRegion(tenant.country);
  const regionVendors = providersForRegion(region);

  // Which carriers does the platform actually have credentials for?
  const creds = await masterCarrierCreds().catch(() => null);
  const configured = new Set<string>();
  configured.add('telroi'); // operator account is always present for NG
  if (creds?.twilio) configured.add('twilio');
  if (creds?.telnyx) configured.add('telnyx');
  // SIP-trunk vendors: configured when their voice credentials are present.
  try {
    const { voiceCredentials } = await import('./voice-credentials');
    const vc = await voiceCredentials();
    if (vc?.asterisk?.sipGateway) configured.add('asterisk');
  } catch { /* */ }

  // Base list = region ∩ configured.
  let ids = regionVendors.filter((v) => configured.has(v));

  // Admin override wins when set (explicit per-client list), still intersected
  // with what's actually configured so we never offer an unusable vendor.
  const override = tenant.sipVendorOverride as string[] | null;
  const overridden = Array.isArray(override);
  if (overridden) ids = override!.filter((v) => configured.has(v));

  return {
    vendors: ids.map((id) => ({ id, label: LABELS[id] || id })),
    region,
    overridden
  };
}
