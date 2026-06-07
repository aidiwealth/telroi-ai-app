// GET /api/wallet -> balance, currency, plan
import { requireTenant } from '~/server/utils/api';
import { getOrCreateWallet } from '~/server/utils/wallet';
export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  const w = await getOrCreateWallet(s.tenantId);
  return { currency: w.currency, balanceMinor: w.balanceMinor, plan: w.plan };
});
