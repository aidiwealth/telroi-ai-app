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

  // Invoices ride the same daily trigger rather than needing a scheduler of
  // their own. Best-effort: a failure here shouldn't undo the billing that has
  // already succeeded, and the next run picks up whatever was missed.
  let invoicing: any = null;
  try {
    const { runInvoicing } = await import('~/server/utils/invoicing');
    invoicing = await runInvoicing();
  } catch (e: any) {
    console.error('[cron] invoicing failed:', e?.message);
    invoicing = { error: e?.message };
  }

  // Chasing and stopping, after issuing — so an invoice raised today is never
  // also chased today.
  let dunning: any = null;
  try {
    const { runDunning } = await import('~/server/utils/invoicing');
    dunning = await runDunning();
  } catch (e: any) {
    console.error('[cron] dunning failed:', e?.message);
    dunning = { error: e?.message };
  }

  return { ok: true, ...result, invoicing, dunning };
});
