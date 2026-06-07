// POST /api/admin/billing/run -> manually trigger a billing run from the admin
// UI (same shared engine as the cron). For operators to run on demand without
// waiting for the scheduled job. Platform-admin only.
import { requirePlatformAdmin } from '~/server/utils/platform';
import { useDb } from '~/server/db';
import { runMonthlyBilling } from '~/server/utils/billing';
export default defineEventHandler(async (event) => {
  await requirePlatformAdmin(event);
  const db = useDb();
  const result = await runMonthlyBilling(db);
  return { ok: true, ...result };
});
