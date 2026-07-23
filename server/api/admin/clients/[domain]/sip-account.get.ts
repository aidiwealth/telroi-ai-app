// GET /api/admin/clients/:domain/sip-account -> the client's manually-entered SIP
// account (host + auth id; password never returned, only whether it's set).
import { eq, or } from 'drizzle-orm';
import { requirePlatformAdmin } from '~/server/utils/platform';
import { apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
import { decrypt } from '~/server/utils/crypto';

export default defineEventHandler(async (event) => {
  await requirePlatformAdmin(event);
  const domain = getRouterParam(event, 'domain')!;
  const slug = domain.replace(/\.telroi\.ai$/, '').split('.')[0];
  const db = useDb();
  const [tenant] = await db.select().from(schema.tenants)
    .where(or(eq(schema.tenants.telroiDomain, domain), eq(schema.tenants.slug, slug))).limit(1);
  if (!tenant) throw apiError('not_found', 'Client not found', 404);

  let host = '', authId = '', passwordSet = false;
  if (tenant.tenantDigiditeSipEnc) {
    try {
      const c = JSON.parse(decrypt(tenant.tenantDigiditeSipEnc));
      host = c.host || ''; authId = c.authId || ''; passwordSet = !!c.password;
    } catch { /* */ }
  }
  return { host, authId, passwordSet };
});
