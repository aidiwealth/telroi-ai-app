// POST /api/admin/clients/:domain/provision-carrier -> admin override to
// provision a NON-Nigeria client's carrier resources EARLY (before the client
// goes live themselves). Nigeria stays Digidite-only via the normal go-live path
// and is rejected here. Superadmin only.
import { eq } from 'drizzle-orm';
import { requirePlatformAdmin } from '~/server/utils/platform';
import { apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
import { resolveTenantByDomain } from '~/server/utils/resolve-tenant';
import { isNigeria } from '~/server/utils/countries';
import { ensureNumberProvisioned } from '~/server/utils/provision-lifecycle';

export default defineEventHandler(async (event) => {
  const admin = await requirePlatformAdmin(event);
  if (admin.role !== 'superadmin') throw apiError('forbidden', 'Superadmin required', 403);
  const t = await resolveTenantByDomain(decodeURIComponent(getRouterParam(event, 'domain')!));
  if (!t) throw apiError('not_found', 'Workspace not found', 404);

  if (isNigeria(t.country)) {
    throw apiError('not_allowed', 'Nigeria runs on Digidite and provisions at go-live only — early carrier provisioning does not apply.', 400);
  }

  const db = useDb();
  // Mark the tenant provisioned (carrier master account is shared; no per-tenant
  // account) so lazy number provisioning is unlocked, then eagerly provision all
  // active numbers now (the admin override).
  await db.update(schema.tenants).set({ provisionState: 'provisioned', wentLiveAt: t.wentLiveAt || new Date() }).where(eq(schema.tenants.id, t.id));

  const subs = await db.select().from(schema.numberSubscriptions)
    .where(eq(schema.numberSubscriptions.tenantId, t.id));
  const results: any[] = [];
  for (const sub of subs.filter((s) => s.status === 'active' && s.provisionState !== 'provisioned')) {
    const r = await ensureNumberProvisioned(t.id, sub.id);
    results.push({ telnum: sub.telnum, ...r });
  }
  return { ok: true, vendor: 'carrier', provisioned: results };
});
