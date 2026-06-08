// GET /api/voice/sip -> CLIENT-FACING SIP info. Deliberately vendor-agnostic:
// the client never sees which carrier (Twilio/Telnyx/Digidite) powers their SIP.
// They see only whether SIP is available to them and, once set up, the generic
// connection details they need to point their own device: a Telroi-branded
// server host, a username, and whether a password is set. All vendor selection
// and configuration lives at the admin level.
import { eq } from 'drizzle-orm';
import { requireTenant } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
import { availableSipVendors } from '~/server/utils/sip';
import { platformSettings } from '~/server/utils/platform';

export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  const db = useDb();

  // Is SIP available for this client at all? (region ∩ platform creds ∩ admin
  // override) — but we expose only the boolean, never the vendor list.
  const { vendors } = await availableSipVendors(s.tenantId);
  const available = vendors.length > 0;
  // Self-serve provisioning only works for fully-automated carriers (twilio/telnyx).
  // Other vendors (telroi/Digidite, sotel, ruach, asterisk) are arranged by admin.
  const selfServe = available && ['twilio', 'telnyx'].includes(vendors[0].id);

  const settings = await platformSettings().catch(() => null);
  const proxy = settings?.sipProxyDomain || null;

  const endpoints = await db.select().from(schema.sipEndpoints).where(eq(schema.sipEndpoints.tenantId, s.tenantId));

  // Neutralise every endpoint: no provider, no kind, no carrier hostname, no
  // labels that reveal the vendor. If a Telroi proxy host is configured we show
  // that; otherwise we show a neutral "Telroi SIP server" with the raw host the
  // device must reach (unavoidable for registration) but unbranded.
  const safeEndpoints = endpoints.map((e) => ({
    id: e.id,
    sipServer: proxy || e.domain || null,   // masked host when proxy is set
    sipUsername: e.sipUsername || null,
    hasPassword: !!e.secretEnc,
    createdAt: e.createdAt
  }));

  return {
    available,
    selfServe,
    proxyConfigured: !!proxy,
    endpoints: safeEndpoints
  };
});
