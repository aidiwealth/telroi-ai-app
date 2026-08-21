// POST /api/admin/clients/:domain/billing-interval { interval }
//
// Monthly or annual. Deliberately changes nothing today: no charge, no refund,
// no proration. The workspace's next billing date stands, and the new interval
// decides what is charged when it comes round — which is also what makes
// switching back safe, since a client who paid for a year keeps the year.
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { requireSuperAdmin } from '~/server/utils/platform';
import { apiError } from '~/server/utils/api';
import { resolveTenantByDomain } from '~/server/utils/resolve-tenant';
import { useDb, schema } from '~/server/db';
import { logEvent } from '~/server/utils/logs';

const Body = z.object({ interval: z.enum(['monthly', 'annual']) });

export default defineEventHandler(async (event) => {
  const admin = await requireSuperAdmin(event);
  const t = await resolveTenantByDomain(decodeURIComponent(getRouterParam(event, 'domain')!));
  if (!t) throw apiError('not_found', 'Workspace not found', 404);

  const p = Body.safeParse(await readBody(event));
  if (!p.success) throw apiError('invalid', 'interval must be monthly or annual');

  await useDb().update(schema.tenants)
    .set({ billingInterval: p.data.interval })
    .where(eq(schema.tenants.id, t.id));

  await logEvent({
    tenantId: t.id, kind: 'system', action: 'billing.interval_changed',
    summary: `Billing interval set to ${p.data.interval} by ${admin.email}`
  });

  return { ok: true, interval: p.data.interval };
});
