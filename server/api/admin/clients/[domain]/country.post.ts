// POST /api/admin/clients/:domain/country { country } -> change a client's
// country and re-align country-driven settings (wallet currency). Superadmin
// only. Guard: currency can only change while the wallet is empty, since
// converting a funded balance between currencies would corrupt accounting.
import { z } from 'zod';
import { eq, or } from 'drizzle-orm';
import { requirePlatformAdmin } from '~/server/utils/platform';
import { apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
import { currencyForCountry } from '~/server/utils/countries';

const Body = z.object({ country: z.string().min(2).max(60) });

export default defineEventHandler(async (event) => {
  const admin = await requirePlatformAdmin(event);
  if (admin.role !== 'superadmin') throw apiError('forbidden', 'Superadmin required', 403);
  const domain = decodeURIComponent(getRouterParam(event, 'domain')!);
  const slug = domain.replace(/\.telroi\.ai$/, '').split('.')[0];
  const p = Body.safeParse(await readBody(event));
  if (!p.success) throw apiError('invalid', 'country required');

  const db = useDb();
  const [tenant] = await db.select().from(schema.tenants)
    .where(or(eq(schema.tenants.telroiDomain, domain), eq(schema.tenants.slug, slug))).limit(1);
  if (!tenant) throw apiError('not_found', 'Client not found', 404);

  const newCurrency = currencyForCountry(p.data.country);
  const [wallet] = await db.select().from(schema.wallets).where(eq(schema.wallets.tenantId, tenant.id)).limit(1);

  let walletRealigned = false;
  if (wallet && wallet.currency !== newCurrency) {
    if (wallet.balanceMinor > 0) {
      throw apiError('wallet_funded', `Can't switch this client to ${newCurrency}: their wallet still holds a balance. Refund/drain the wallet to zero first, then change the country.`, 409);
    }
    await db.update(schema.wallets).set({ currency: newCurrency }).where(eq(schema.wallets.id, wallet.id));
    walletRealigned = true;
  }

  await db.update(schema.tenants).set({ country: p.data.country }).where(eq(schema.tenants.id, tenant.id));
  return { ok: true, country: p.data.country, currency: newCurrency, walletRealigned };
});
