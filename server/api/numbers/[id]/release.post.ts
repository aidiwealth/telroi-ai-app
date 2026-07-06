// POST /api/numbers/:id/release -> client releases (unsubscribes from) a number.
// The subscription is cancelled immediately (billing stops, routing stops), and a
// grace period begins. The number stays reserved to this tenant during grace so
// they can reclaim it; after grace ends, a scheduled job returns it to inventory.
import { and, eq } from 'drizzle-orm';
import { requireTenant, apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';

const GRACE_DAYS = 7;

export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  const id = getRouterParam(event, 'id');
  if (!id) throw apiError('invalid', 'id required', 400);
  const db = useDb();

  const [sub] = await db.select().from(schema.numberSubscriptions)
    .where(and(eq(schema.numberSubscriptions.id, id), eq(schema.numberSubscriptions.tenantId, s.tenantId))).limit(1);
  if (!sub) throw apiError('not_found', 'Number not found on your account', 404);
  if (sub.status === 'cancelled') throw apiError('already', 'This number is already released', 400);

  const graceEnds = new Date(Date.now() + GRACE_DAYS * 24 * 3600 * 1000);
  await db.update(schema.numberSubscriptions)
    .set({ status: 'cancelled', cancelledAt: new Date(), graceEndsAt: graceEnds })
    .where(eq(schema.numberSubscriptions.id, id));

  return {
    ok: true,
    message: `Number released. It stays reserved to you until ${graceEnds.toISOString().slice(0, 10)}, then returns to the pool. You won't be billed for it again.`,
    graceEndsAt: graceEnds.toISOString()
  };
});
