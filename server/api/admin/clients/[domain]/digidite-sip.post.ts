// POST /api/admin/clients/:domain/digidite-sip { host, authId, password }
// Sets the client-specific Digidite SIP account. Superadmin only. Blank password
// keeps the existing one. Stored encrypted as JSON {host, authId, password}.
import { z } from 'zod';
import { eq, or } from 'drizzle-orm';
import { requirePlatformAdmin } from '~/server/utils/platform';
import { apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
import { encrypt, decrypt } from '~/server/utils/crypto';
import { logEvent } from '~/server/utils/logs';

const Body = z.object({ host: z.string().optional(), authId: z.string().optional(), password: z.string().optional() });

export default defineEventHandler(async (event) => {
  const admin = await requirePlatformAdmin(event);
  if (admin.role !== 'superadmin') throw apiError('forbidden', 'Superadmin required', 403);
  const domain = getRouterParam(event, 'domain')!;
  const slug = domain.replace(/\.telroi\.ai$/, '').split('.')[0];
  const p = Body.safeParse(await readBody(event));
  if (!p.success) throw apiError('invalid', 'Invalid SIP fields');

  const db = useDb();
  const [tenant] = await db.select().from(schema.tenants)
    .where(or(eq(schema.tenants.telroiDomain, domain), eq(schema.tenants.slug, slug))).limit(1);
  if (!tenant) throw apiError('not_found', 'Client not found', 404);

  let existing: any = {};
  if (tenant.tenantDigiditeSipEnc) { try { existing = JSON.parse(decrypt(tenant.tenantDigiditeSipEnc)); } catch { /* */ } }
  const next = {
    host: p.data.host ?? existing.host ?? '',
    authId: p.data.authId ?? existing.authId ?? '',
    password: p.data.password ? p.data.password : (existing.password ?? '')
  };
  await db.update(schema.tenants).set({ tenantDigiditeSipEnc: encrypt(JSON.stringify(next)) }).where(eq(schema.tenants.id, tenant.id));
  await logEvent({ tenantId: tenant.id, kind: 'system', action: 'admin.digidite_sip', summary: `${admin.email} updated Digidite SIP account` });
  return { ok: true };
});
