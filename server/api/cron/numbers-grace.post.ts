// POST /api/cron/numbers-grace  (header: x-cron-secret: $CRON_SECRET)
// Returns released numbers to the inventory pool once their grace period ends.
// A released number's subscription is 'cancelled' with grace_ends_at set; when
// that passes, we free the inventory row (status -> available, soldToTenantId
// cleared) so anyone can rebuy it. Hit hourly/daily by the external scheduler.
import { and, eq, lt, isNotNull } from 'drizzle-orm';
import { useDb, schema } from '~/server/db';

export default defineEventHandler(async (event) => {
  const secret = (useRuntimeConfig() as any).cronSecret;
  const given = getHeader(event, 'x-cron-secret');
  if (secret && given !== secret) throw createError({ statusCode: 401, statusMessage: 'bad cron secret' });

  const db = useDb();
  const now = new Date();

  // Find cancelled subscriptions whose grace has ended.
  const expired = await db.select().from(schema.numberSubscriptions)
    .where(and(
      eq(schema.numberSubscriptions.status, 'cancelled'),
      isNotNull(schema.numberSubscriptions.graceEndsAt),
      lt(schema.numberSubscriptions.graceEndsAt, now)
    ));

  let returned = 0;
  for (const sub of expired) {
    // Return the inventory row to the pool (match by telnum).
    await db.update(schema.numberInventory)
      .set({ status: 'available', soldToTenantId: null })
      .where(eq(schema.numberInventory.telnum, sub.telnum));
    // Mark the subscription fully released (so the job doesn't reprocess it).
    await db.update(schema.numberSubscriptions)
      .set({ status: 'released', graceEndsAt: null })
      .where(eq(schema.numberSubscriptions.id, sub.id));
    returned++;
  }

  return { ok: true, checked: expired.length, returned };
});
