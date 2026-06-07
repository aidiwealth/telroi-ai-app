// GET /api/admin/clients/:domain/sip-vendors -> current SIP vendor gating for a
// client: region, whether an override is set, the raw override, and the
// effective vendor list (what the client actually sees).
import { eq } from 'drizzle-orm';
import { requirePlatformAdmin } from '~/server/utils/platform';
import { apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
import { availableSipVendors } from '~/server/utils/sip';

export default defineEventHandler(async (event) => {
  await requirePlatformAdmin(event);
  const domain = getRouterParam(event, 'domain')!;
  const db = useDb();
  const [tenant] = await db.select().from(schema.tenants).where(eq(schema.tenants.telroiDomain, domain)).limit(1);
  if (!tenant) throw apiError('not_found', 'Client not found', 404);

  const { vendors, region, overridden } = await availableSipVendors(tenant.id);
  // All vendors valid for this client's region (regardless of override) so the
  // admin UI can render the full set of choices to toggle.
  const { providersForRegion } = await import('~/server/utils/regions');
  const candidateIds = providersForRegion(region);
  const LABELS: Record<string, string> = { telroi: 'Telroi (Digidite)', twilio: 'Twilio', telnyx: 'Telnyx', sotel: 'Sotel', ruach: 'Ruach', asterisk: 'Core Asterisk' };
  return {
    region, overridden,
    override: (tenant.sipVendorOverride as string[] | null) ?? null,
    effective: vendors.map((v) => v.id),
    candidates: candidateIds.map((id) => ({ id, label: LABELS[id] || id }))
  };
});
