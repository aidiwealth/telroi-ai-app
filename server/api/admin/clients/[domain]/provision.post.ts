// POST /api/admin/clients/:domain/provision -> (re)provision a tenant's Digidite
// PBX subdomain. Superadmin only. Used when auto-provisioning at signup didn't
// run (e.g. Operator API wasn't configured yet).
import { eq } from 'drizzle-orm';
import { requirePlatformAdmin } from '~/server/utils/platform';
import { apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
import { provisionTenant } from '~/server/utils/provisioning';

export default defineEventHandler(async (event) => {
  const admin = await requirePlatformAdmin(event);
  if (admin.role !== 'superadmin') throw apiError('forbidden', 'Superadmin required', 403);
  const domainParam = decodeURIComponent(getRouterParam(event, 'domain')!);
  const db = useDb();

  // The route param may be the telroiDomain or the slug — match either.
  const [t] = await db.select().from(schema.tenants)
    .where(eq(schema.tenants.slug, domainParam.split('.')[0])).limit(1);
  if (!t) throw apiError('not_found', 'Workspace not found', 404);

  const r = await provisionTenant(t.id);
  if (!r.ok) {
    console.error('[admin provision] failed for', t.slug, '->', JSON.stringify(r.reason));
    throw apiError('provision_failed', provisionMessage(r.reason), 502);
  }
  return { ok: true, domain: r.domain };
});

function provisionMessage(reason?: string) {
  if (reason === 'operator_not_configured') return 'The Operator/Digidite API isn’t configured in Settings yet.';
  return reason || 'Provisioning failed';
}
