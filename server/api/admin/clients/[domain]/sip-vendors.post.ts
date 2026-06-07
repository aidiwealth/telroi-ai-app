// POST /api/admin/clients/:domain/sip-vendors { vendors: string[] | null }
// Admin override of which SIP vendors a client may use. null clears the override
// (revert to automatic region-based gating). Superadmin only.
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { requirePlatformAdmin } from '~/server/utils/platform';
import { apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
import { logEvent } from '~/server/utils/logs';

const Body = z.object({ vendors: z.array(z.enum(['twilio', 'telnyx', 'telroi', 'sotel', 'ruach', 'asterisk'])).nullable() });

export default defineEventHandler(async (event) => {
  const admin = await requirePlatformAdmin(event);
  if (admin.role !== 'superadmin') throw apiError('forbidden', 'Superadmin required', 403);
  const domain = getRouterParam(event, 'domain')!;
  const p = Body.safeParse(await readBody(event));
  if (!p.success) throw apiError('invalid', 'vendors must be an array or null');

  const db = useDb();
  const [tenant] = await db.select().from(schema.tenants)
    .where(eq(schema.tenants.telroiDomain, domain)).limit(1);
  if (!tenant) throw apiError('not_found', 'Client not found', 404);

  await db.update(schema.tenants).set({ sipVendorOverride: p.data.vendors }).where(eq(schema.tenants.id, tenant.id));
  await logEvent({ tenantId: tenant.id, kind: 'system', action: 'admin.sip_vendors', summary: `${admin.email} set SIP vendors: ${p.data.vendors ? p.data.vendors.join(',') : 'auto'}` });
  return { ok: true };
});
