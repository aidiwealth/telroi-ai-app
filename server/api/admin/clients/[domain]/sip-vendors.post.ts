// POST /api/admin/clients/:domain/sip-vendors { vendors: string[] | null }
// Admin override of which SIP vendors a client may use. null clears the override
// (revert to automatic region-based gating). Superadmin only.
import { z } from 'zod';
import { eq, or } from 'drizzle-orm';
import { requirePlatformAdmin } from '~/server/utils/platform';
import { apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
import { logEvent } from '~/server/utils/logs';

const Body = z.object({
  vendors: z.array(z.enum(['twilio', 'telnyx', 'telroi', 'asterisk'])).nullable().optional(),
  sipDeviceVendor: z.enum(['telroi', 'twilio', 'telnyx']).nullable().optional()
});

export default defineEventHandler(async (event) => {
  const admin = await requirePlatformAdmin(event);
  if (admin.role !== 'superadmin') throw apiError('forbidden', 'Superadmin required', 403);
  const domain = getRouterParam(event, 'domain')!;
  const p = Body.safeParse(await readBody(event));
  if (!p.success) throw apiError('invalid', 'Invalid SIP vendor fields');

  const slug = domain.replace(/\.telroi\.ai$/, '').split('.')[0];
  const db = useDb();
  const [tenant] = await db.select().from(schema.tenants)
    .where(or(eq(schema.tenants.telroiDomain, domain), eq(schema.tenants.slug, slug))).limit(1);
  if (!tenant) throw apiError('not_found', 'Client not found', 404);

  const patch: any = {};
  if (p.data.vendors !== undefined) patch.sipVendorOverride = p.data.vendors;
  if (p.data.sipDeviceVendor !== undefined) patch.sipDeviceVendor = p.data.sipDeviceVendor;
  if (Object.keys(patch).length === 0) throw apiError('invalid', 'Nothing to update');
  await db.update(schema.tenants).set(patch).where(eq(schema.tenants.id, tenant.id));
  const summary = [
    p.data.vendors !== undefined ? `calling vendors: ${p.data.vendors ? p.data.vendors.join(',') : 'auto'}` : null,
    p.data.sipDeviceVendor !== undefined ? `SIP vendor: ${p.data.sipDeviceVendor || 'none'}` : null
  ].filter(Boolean).join('; ');
  await logEvent({ tenantId: tenant.id, kind: 'system', action: 'admin.sip_vendors', summary: `${admin.email} updated ${summary}` });
  return { ok: true };
});
