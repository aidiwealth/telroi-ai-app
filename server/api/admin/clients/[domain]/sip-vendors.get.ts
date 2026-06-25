// GET /api/admin/clients/:domain/sip-vendors -> current SIP vendor gating for a
// client: region, whether an override is set, the raw override, and the
// effective vendor list (what the client actually sees).
import { eq, or } from 'drizzle-orm';
import { requirePlatformAdmin } from '~/server/utils/platform';
import { apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
import { availableSipVendors } from '~/server/utils/sip';

export default defineEventHandler(async (event) => {
  await requirePlatformAdmin(event);
  const domain = getRouterParam(event, 'domain')!;
  const slug = domain.replace(/\.telroi\.ai$/, '').split('.')[0];
  const db = useDb();
  const [tenant] = await db.select().from(schema.tenants)
    .where(or(eq(schema.tenants.telroiDomain, domain), eq(schema.tenants.slug, slug))).limit(1);
  if (!tenant) throw apiError('not_found', 'Client not found', 404);

  const { vendors, region, overridden } = await availableSipVendors(tenant.id);
  // Show ALL vendors as toggle choices; flag which match the client's region.
  const { providersForRegion } = await import('~/server/utils/regions');
  const regionSet = new Set(providersForRegion(region));
  const ALL = ['telroi', 'asterisk', 'twilio', 'telnyx'];
  const LABELS: Record<string, string> = { telroi: 'Telroi Voice', twilio: 'Twilio', telnyx: 'Telnyx', asterisk: 'Telroi Voice' };
  return {
    region, overridden,
    override: (tenant.sipVendorOverride as string[] | null) ?? null,
    effective: vendors.map((v) => v.id),
    candidates: ALL.map((id) => ({ id, label: LABELS[id] || id, regionMatch: regionSet.has(id) })),
    sipDeviceVendor: (tenant.sipDeviceVendor as string | null) ?? null,
    sipDeviceOptions: ['telroi', 'twilio', 'telnyx'].map((id) => ({ id, label: LABELS[id] || id }))
  };
});
