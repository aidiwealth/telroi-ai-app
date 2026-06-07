// POST /api/wallet/topup { amountMinor } -> initialize checkout with the right
// provider for the wallet currency (Paystack for NGN, Stripe for USD).
// Records a pending payment; the wallet is credited ONLY by the verified webhook.
import { z } from 'zod';
import { requireTenant, apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
import { getOrCreateWallet } from '~/server/utils/wallet';
import { paystack, stripe } from '~/server/utils/payments';
import { paymentCreds } from '~/server/utils/platform';
import { randomToken } from '~/server/utils/crypto';

const Body = z.object({ amountMinor: z.number().int().positive() });

export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  const p = Body.safeParse(await readBody(event));
  if (!p.success) throw apiError('invalid', 'amountMinor (positive integer) required');

  const cfg = useRuntimeConfig();
  const pay = await paymentCreds(s.tenantId);
  const w = await getOrCreateWallet(s.tenantId);
  const reference = `tlr_${randomToken(12).replace(/[^a-zA-Z0-9]/g, '').slice(0, 18)}`;
  const base = cfg.public.appBaseUrl;
  const db = useDb();

  // Sandbox: never touch a real payment provider. Credit simulated funds
  // immediately so the workspace can test wallet-funded flows safely.
  const { isSandbox } = await import('~/server/utils/sandbox');
  if (await isSandbox(s.tenantId)) {
    const { credit } = await import('~/server/utils/wallet');
    const r = await credit(s.tenantId, p.data.amountMinor, 'sandbox_topup', `sbx_${reference}`, { simulated: true });
    return { provider: 'sandbox', simulated: true, livemode: false, balanceMinor: r.balanceMinor, reference };
  }

  // Provider selection: an admin per-client override wins; otherwise route by
  // wallet currency (Paystack for NGN, Stripe for USD).
  const provider = pay.override || (w.currency === 'NGN' ? 'paystack' : 'stripe');

  await db.insert(schema.payments).values({
    tenantId: s.tenantId, provider,
    reference, amountMinor: p.data.amountMinor, currency: w.currency, status: 'pending'
  });

  if (provider === 'paystack') {
    if (!pay.paystack) throw apiError('not_configured', 'Paystack is not configured', 503);
    const init = await paystack.init(pay.paystack, s.email, p.data.amountMinor, reference, `${base}/wallet?ref=${reference}`);
    return { provider: 'paystack', ...init };
  } else if (provider === 'monnify') {
    // Monnify uses reserved bank accounts rather than a redirect checkout.
    throw apiError('use_bank_transfer', 'This account funds via bank transfer. Use the bank-transfer (reserved account) option.', 400);
  } else {
    if (!pay.stripe) throw apiError('not_configured', 'Stripe is not configured', 503);
    const init = await stripe.init(pay.stripe, p.data.amountMinor, reference, `${base}/wallet?ref=${reference}`, `${base}/wallet`);
    return { provider: 'stripe', ...init };
  }
});
