// GET /v1/numbers/available -> inventory numbers this workspace can buy, with
// the first-month cost (DID + 1 channel) in the wallet currency. The carrier is
// Telroi infrastructure and intentionally not exposed. Requires numbers:read.
import { eq, desc } from 'drizzle-orm';
import { requireApiKey, hasScope } from '~/server/utils/apikey-auth';
import { apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
import { regionLabel } from '~/server/utils/regions';
import { getOrCreateWallet } from '~/server/utils/wallet';
import { getPricing, toCurrencyMinor } from '~/server/utils/pricing';

export default defineEventHandler(async (event) => {
  const ctx = await requireApiKey(event);
  if (!hasScope(ctx, 'numbers:read')) throw apiError('forbidden', 'Key lacks numbers:read', 403);
  const db = useDb();
  const rows = await db.select().from(schema.numberInventory)
    .where(eq(schema.numberInventory.status, 'available')).orderBy(desc(schema.numberInventory.createdAt));
  const wallet = await getOrCreateWallet(ctx.tenantId);
  const pricing = await getPricing(ctx.tenantId);
  const didMinor = toCurrencyMinor(pricing.didMonthlyUsdMinor, wallet.currency as any, pricing.ngnPerUsd);
  const chMinor = toCurrencyMinor(pricing.channelMonthlyUsdMinor, wallet.currency as any, pricing.ngnPerUsd);
  return {
    object: 'list',
    data: rows.map((r) => ({ id: r.id, telnum: r.telnum, region: r.region, region_label: regionLabel(r.region) })),
    first_month_minor: didMinor + chMinor,
    currency: wallet.currency
  };
});
