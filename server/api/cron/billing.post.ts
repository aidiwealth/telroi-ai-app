// POST /api/cron/billing  (header: x-cron-secret: $CRON_SECRET)
// Recurring monthly billing runner. Charges number subscriptions whose
// nextBillingAt has passed (DID + channels * channel fee) from the wallet,
// suspends those that can't pay, and is idempotent per cycle. Designed to be
// hit by an external scheduler (cron / DigitalOcean scheduled job) once a day.
// If CRON_SECRET isn't configured, a platform admin can trigger it manually.
import { useDb } from '~/server/db';
import { runMonthlyBilling } from '~/server/utils/billing';

export default defineEventHandler(async (event) => {
  const secret = (useRuntimeConfig() as any).cronSecret;
  const given = getHeader(event, 'x-cron-secret');
  if (secret) {
    if (given !== secret) throw createError({ statusCode: 401, statusMessage: 'bad cron secret' });
  } else {
    const { requirePlatformAdmin } = await import('~/server/utils/platform');
    await requirePlatformAdmin(event);
  }

  const db = useDb();
  const result = await runMonthlyBilling(db);
  return { ok: true, ...result };
});
