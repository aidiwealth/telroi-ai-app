// GET /api/wallet -> balance, currency, plan
import { requireTenantManager } from '~/server/utils/api';
import { getOrCreateWallet } from '~/server/utils/wallet';
import { useDb } from '~/server/db';
import { eq } from 'drizzle-orm';
export default defineEventHandler(async (event) => {
  const s = await requireTenantManager(event);
  const w = await getOrCreateWallet(s.tenantId);
  // Postpaid changes what this number means: it goes negative by design, and a
  // client watching that without context would reasonably think something had
  // broken. The page needs enough to say "used this period" rather than showing
  // a deficit.
  const { schema: sch } = await import('~/server/db');
  const [t] = await useDb().select({
    postpaid: sch.tenants.postpaid,
    creditLimitMinor: sch.tenants.creditLimitMinor,
    billingDay: sch.tenants.billingDay
  }).from(sch.tenants).where(eq(sch.tenants.id, s.tenantId)).limit(1);

  let nextInvoiceAt: string | null = null;
  if (t?.postpaid && t.billingDay) {
    const now = new Date();
    const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), t.billingDay, 0, 0, 0));
    if (next <= now) next.setUTCMonth(next.getUTCMonth() + 1);
    nextInvoiceAt = next.toISOString();
  }

  return {
    currency: w.currency, balanceMinor: w.balanceMinor, plan: w.plan,
    postpaid: !!t?.postpaid,
    creditLimitMinor: t?.creditLimitMinor ?? null,
    billingDay: t?.billingDay ?? null,
    nextInvoiceAt
  };
});
