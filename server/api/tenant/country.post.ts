// POST /api/tenant/country { country } -> a client updates their own workspace
// country. Country drives wallet currency (Nigeria → ₦ NGN, elsewhere → $ USD)
// and call routing region. Same safety guard as the admin path: the currency
// (and thus country, when it would change currency) can only change while the
// wallet is empty, since converting a funded balance would corrupt accounting.
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { requireTenant, apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
import { currencyForCountry } from '~/server/utils/countries';

const Body = z.object({ country: z.string().min(2).max(60) });

export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  const p = Body.safeParse(await readBody(event));
  if (!p.success) throw apiError('invalid', 'country required');
  const db = useDb();

  const newCurrency = currencyForCountry(p.data.country);
  const [wallet] = await db.select().from(schema.wallets).where(eq(schema.wallets.tenantId, s.tenantId)).limit(1);

  let walletRealigned = false;
  if (wallet && wallet.currency !== newCurrency) {
    if (wallet.balanceMinor > 0) {
      throw apiError('wallet_funded', `Your wallet currency would change to ${newCurrency}, but it still holds a balance. Spend or withdraw your balance to zero first, or contact support.`, 409);
    }
    await db.update(schema.wallets).set({ currency: newCurrency }).where(eq(schema.wallets.id, wallet.id));
    walletRealigned = true;
  }

  await db.update(schema.tenants).set({ country: p.data.country }).where(eq(schema.tenants.id, s.tenantId));
  return { ok: true, country: p.data.country, currency: newCurrency, walletRealigned };
});
