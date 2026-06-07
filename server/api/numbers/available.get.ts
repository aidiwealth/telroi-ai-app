// GET /api/numbers/available -> inventory numbers a customer can buy, plus the
// first-month cost (DID + 1 channel) in the wallet currency. Does NOT expose the
// carrier/provider — that's Telroi infrastructure, invisible to the customer.
import { eq, desc } from 'drizzle-orm';
import { requireTenant } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
import { regionLabel } from '~/server/utils/regions';
import { getOrCreateWallet } from '~/server/utils/wallet';
import { getPricing, toCurrencyMinor } from '~/server/utils/pricing';

export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  const db = useDb();
  const rows = await db.select().from(schema.numberInventory)
    .where(eq(schema.numberInventory.status, 'available')).orderBy(desc(schema.numberInventory.createdAt));

  const wallet = await getOrCreateWallet(s.tenantId);
  const pricing = await getPricing(s.tenantId);
  const didMinor = toCurrencyMinor(pricing.didMonthlyUsdMinor, wallet.currency as any, pricing.ngnPerUsd);
  const chMinor = toCurrencyMinor(pricing.channelMonthlyUsdMinor, wallet.currency as any, pricing.ngnPerUsd);
  const firstMonthMinor = didMinor + chMinor; // DID + 1 channel

  return {
    numbers: rows.map((r) => ({
      id: r.id, telnum: r.telnum, region: r.region, regionLabel: regionLabel(r.region),
      monthlyUsdMinorOverride: r.monthlyUsdMinorOverride
    })),
    firstMonthMinor,
    currency: wallet.currency
  };
});
