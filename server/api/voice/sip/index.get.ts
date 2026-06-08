// GET /api/voice/sip -> CLIENT-FACING SIP info. Deliberately vendor-agnostic:
// the client never sees which carrier (Twilio/Telnyx/Digidite) powers their SIP.
// They see only whether SIP is available to them and, once set up, the generic
// connection details they need to point their own device: a Telroi-branded
// server host, a username, and whether a password is set. All vendor selection
// and configuration lives at the admin level.
import { eq } from 'drizzle-orm';
import { requireTenant } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
import { platformSettings } from '~/server/utils/platform';
import { decrypt } from '~/server/utils/crypto';

export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  const db = useDb();
  const [tenant] = await db.select().from(schema.tenants).where(eq(schema.tenants.id, s.tenantId)).limit(1);

  // SIP availability is driven by the dedicated SIP vendor set by admin
  // (separate from calling/routing vendors). null = no BYOD SIP.
  const sipVendor = (tenant?.sipDeviceVendor as string | null) || null;
  const available = !!sipVendor;
  const selfServe = available && ['twilio', 'telnyx'].includes(sipVendor as string);

  const settings = await platformSettings().catch(() => null);
  const proxy = settings?.sipProxyDomain || null;

  const endpoints = await db.select().from(schema.sipEndpoints).where(eq(schema.sipEndpoints.tenantId, s.tenantId));

  // Neutralise every endpoint: no provider, no kind, no carrier hostname, no
  // labels that reveal the vendor. If a Telroi proxy host is configured we show
  // that; otherwise we show a neutral "Telroi SIP server" with the raw host the
  // device must reach (unavoidable for registration) but unbranded.
  const safeEndpoints = endpoints.map((e) => ({
    id: e.id,
    sipServer: proxy || e.domain || null,
    sipUsername: e.sipUsername || null,
    password: e.secretEnc ? (() => { try { return decrypt(e.secretEnc); } catch { return null; } })() : null,
    hasPassword: !!e.secretEnc,
    canRouteNumber: ['twilio', 'telnyx'].includes(e.provider as string),
    createdAt: e.createdAt
  }));

  if (sipVendor === 'telroi' && tenant?.tenantDigiditeSipEnc) {
    try {
      const c = JSON.parse(decrypt(tenant.tenantDigiditeSipEnc));
      if (c.host || c.authId) {
        safeEndpoints.push({ id: 'digidite-sip', sipServer: proxy || c.host || null, sipUsername: c.authId || null, password: c.password || null, hasPassword: !!c.password, canRouteNumber: false, createdAt: tenant.createdAt } as any);
      }
    } catch { /* */ }
  }

  return {
    available,
    selfServe,
    proxyConfigured: !!proxy,
    endpoints: safeEndpoints
  };
});
