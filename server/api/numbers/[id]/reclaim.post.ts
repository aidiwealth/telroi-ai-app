// POST /api/numbers/:id/reclaim -> client re-activates a released number during
// the grace period (before it returns to the pool).
import { and, eq } from 'drizzle-orm';
import { requireTenant, apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';

export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  const id = getRouterParam(event, 'id');
  if (!id) throw apiError('invalid', 'id required', 400);
  const db = useDb();

  const [sub] = await db.select().from(schema.numberSubscriptions)
    .where(and(eq(schema.numberSubscriptions.id, id), eq(schema.numberSubscriptions.tenantId, s.tenantId))).limit(1);
  if (!sub) throw apiError('not_found', 'Number not found on your account', 404);
  if (sub.status !== 'cancelled') throw apiError('invalid', 'This number is not released', 400);
  if (sub.graceEndsAt && new Date(sub.graceEndsAt) < new Date()) throw apiError('expired', 'The grace period has ended; this number has returned to the pool', 400);

  await db.update(schema.numberSubscriptions)
    .set({ status: 'active', cancelledAt: null, graceEndsAt: null })
    .where(eq(schema.numberSubscriptions.id, id));
  return { ok: true, message: 'Number re-activated. Billing resumes on the next cycle.' };
});
