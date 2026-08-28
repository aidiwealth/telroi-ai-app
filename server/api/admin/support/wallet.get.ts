// GET /api/admin/support/wallet -> the support workspace's balance.
//
// Read-only. Topping up is done from the console, where an operator can see the
// billing context around it — a phone is for knowing whether the balance is
// healthy, not for moving money.
import { eq } from 'drizzle-orm';
import { requirePlatformAdmin } from '~/server/utils/platform';
import { ensureSupportWorkspace } from '~/server/utils/support';
import { getOrCreateWallet } from '~/server/utils/wallet';
import { useDb, schema } from '~/server/db';

export default defineEventHandler(async (event) => {
  await requirePlatformAdmin(event);
  const ws = await ensureSupportWorkspace();
  const w = await getOrCreateWallet(ws.tenantId);

  const [t] = await useDb().select({
    postpaid: schema.tenants.postpaid,
    creditLimitMinor: schema.tenants.creditLimitMinor
  }).from(schema.tenants).where(eq(schema.tenants.id, ws.tenantId)).limit(1);

  return {
    currency: w.currency, balanceMinor: w.balanceMinor, plan: w.plan,
    postpaid: !!t?.postpaid,
    creditLimitMinor: t?.creditLimitMinor ?? null
  };
});
