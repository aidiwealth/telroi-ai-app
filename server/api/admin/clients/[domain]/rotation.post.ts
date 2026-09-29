// POST /api/admin/clients/:domain/rotation { telnum, enabled }
//
// Opt a number into (or out of) outbound caller-ID rotation. When 2+ of a
// tenant's numbers on the same carrier are enabled, each outbound call presents
// the least-recently-used of them, spreading volume so no single number trips a
// carrier's / NCC's high-volume block. The pick is atomic (one function, shared
// last_used_at) across every call path — dialplan, API, notify.
import { and, eq } from 'drizzle-orm';
import { requirePlatformAdmin } from '~/server/utils/platform';
import { resolveTenantByDomain } from '~/server/utils/resolve-tenant';
import { apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';

export default defineEventHandler(async (event) => {
  await requirePlatformAdmin(event);   // staff may manage routing
  const domain = getRouterParam(event, 'domain') || '';
  const body = await readBody<{ telnum?: string; enabled?: boolean }>(event);
  if (!body?.telnum || typeof body.enabled !== 'boolean') {
    throw apiError('invalid', 'telnum and enabled are required');
  }
  const tenant = await resolveTenantByDomain(domain);
  if (!tenant) throw apiError('not_found', 'Workspace not found', 404);

  const db = useDb();
  const res = await db.update(schema.numberSubscriptions)
    .set({ rotationEnabled: body.enabled })
    .where(and(
      eq(schema.numberSubscriptions.tenantId, tenant.id),
      eq(schema.numberSubscriptions.telnum, body.telnum)
    )).returning({ telnum: schema.numberSubscriptions.telnum });
  if (!res.length) throw apiError('not_found', 'That number is not on this workspace.', 404);
  return { ok: true, telnum: body.telnum, enabled: body.enabled };
});
