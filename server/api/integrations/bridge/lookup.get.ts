// GET /api/integrations/bridge/lookup?key=WIDGET_KEY&phone=+234...
// Screen-pop / click-to-call lookup for the in-CRM embed panel. Authenticated by
// the tenant's widget key (the panel runs inside the CRM, not a Telroi session).
// Returns who's calling, looked up across the tenant's connected CRMs and the
// local Telroi CRM. CORS-open GET (no secrets returned beyond contact basics).
import { eq } from 'drizzle-orm';
import { useDb, schema } from '~/server/db';
import { lookupCallerInCrms } from '~/server/utils/integrations/events';

export default defineEventHandler(async (event) => {
  setHeader(event, 'access-control-allow-origin', '*');
  // Per-IP rate limit: this endpoint hits the DB and fans out to external CRMs,
  // so cap it to blunt unauthenticated flooding (it's CORS-open by design).
  const { rateLimit, clientIp } = await import('~/server/utils/api');
  rateLimit('bridge_lookup_ip', clientIp(event), 120, 60 * 1000);
  const q = getQuery(event);
  const key = String(q.key || ''); const phone = String(q.phone || '');
  if (!key || !phone) { setResponseStatus(event, 400); return { error: 'key and phone required' }; }
  const db = useDb();
  let tenant: { id: string } | undefined;
  try {
    [tenant] = await db.select({ id: schema.tenants.id }).from(schema.tenants).where(eq(schema.tenants.widgetKey, key)).limit(1);
  } catch { setResponseStatus(event, 503); return { error: 'temporarily unavailable' }; }
  if (!tenant) { setResponseStatus(event, 401); return { error: 'invalid key' }; }

  // First the connected CRMs, then fall back to the local Telroi CRM.
  const crmHit = await lookupCallerInCrms(tenant.id, phone);
  if (crmHit) return { found: true, source: crmHit.provider, contact: crmHit.contact };

  const { and, like } = await import('drizzle-orm');
  const tail = phone.replace(/[^\d]/g, '').slice(-9);
  const [local] = await db.select({ id: schema.crmContacts.id, name: schema.crmContacts.name, email: schema.crmContacts.email, company: schema.crmContacts.company })
    .from(schema.crmContacts)
    .where(and(eq(schema.crmContacts.tenantId, tenant.id), like(schema.crmContacts.phone, `%${tail}`)))
    .limit(1);
  if (local) return { found: true, source: 'telroi', contact: { externalId: local.id, name: local.name, email: local.email, company: local.company, phone } };
  return { found: false };
});
