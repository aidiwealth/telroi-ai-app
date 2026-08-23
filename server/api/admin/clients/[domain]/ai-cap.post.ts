// POST /api/admin/clients/:domain/ai-cap { capUsdMinor }
//
// What managed AI may spend for this workspace in a day. Null means the
// platform's figure; zero removes the ceiling entirely, which is worth doing
// only where somebody expects real volume — it is what stops a robocaller
// running up a client's bill on calls they never wanted.
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { requireSuperAdmin } from '~/server/utils/platform';
import { apiError } from '~/server/utils/api';
import { resolveTenantByDomain } from '~/server/utils/resolve-tenant';
import { useDb, schema } from '~/server/db';
import { logEvent } from '~/server/utils/logs';

const Body = z.object({ capUsdMinor: z.number().int().min(0).nullable() });

export default defineEventHandler(async (event) => {
  const admin = await requireSuperAdmin(event);
  const t = await resolveTenantByDomain(decodeURIComponent(getRouterParam(event, 'domain')!));
  if (!t) throw apiError('not_found', 'Workspace not found', 404);

  const p = Body.safeParse(await readBody(event));
  if (!p.success) throw apiError('invalid', 'capUsdMinor must be a whole number of cents, or null');

  await useDb().update(schema.tenants)
    .set({ aiDailyCapUsdMinor: p.data.capUsdMinor })
    .where(eq(schema.tenants.id, t.id));

  await logEvent({
    tenantId: t.id, kind: 'system', action: 'ai.cap_changed',
    summary: p.data.capUsdMinor === null
      ? `AI daily cap set to the platform default by ${admin.email}`
      : p.data.capUsdMinor === 0
        ? `AI daily cap removed by ${admin.email}`
        : `AI daily cap set to $${(p.data.capUsdMinor / 100).toFixed(2)} by ${admin.email}`
  });

  return { ok: true };
});
