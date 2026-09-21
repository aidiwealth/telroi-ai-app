// POST /api/wallet/topup { amountMinor } -> initialize checkout with the right
// provider for the wallet currency (Paystack for NGN, Stripe for USD).
// Records a pending payment; the wallet is credited ONLY by the verified webhook.
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { requireTenantManager, apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
import { getOrCreateWallet } from '~/server/utils/wallet';
import { paystack, stripe } from '~/server/utils/payments';
import { paymentCreds } from '~/server/utils/platform';
import { randomToken } from '~/server/utils/crypto';
import { PAYMENT_METHOD_SAVE_CONSENT_VERSION } from '~/server/utils/payment-methods';

const Body = z.object({
  amountMinor: z.number().int().positive(),
  // Where to send them back to. Onboarding needs them returned to the wizard
  // rather than dropped on the wallet page mid-signup.
  returnTo: z.string().max(120).optional(),
  savePaymentMethod: z.boolean().optional().default(false)
});

export default defineEventHandler(async (event) => {
  const s = await requireTenantManager(event);
  const p = Body.safeParse(await readBody(event));
  if (!p.success) throw apiError('invalid', 'amountMinor (positive integer) required');

  const cfg = useRuntimeConfig();
  const pay = await paymentCreds(s.tenantId);
  const w = await getOrCreateWallet(s.tenantId);

  // A saved payment method can later move money. Admins may fund a workspace,
  // but only its owner can choose a card for future charges.
  if (p.data.savePaymentMethod && s.role !== 'owner') {
    throw apiError('forbidden', 'Only the workspace owner can save a payment method.', 403);
  }

  // Saving a card is part of an ordinary top-up, so the same configured minimum
  // applies whether or not the owner selects the save option.
  const { getPricing } = await import('~/server/utils/pricing');
  const pr: any = await getPricing(s.tenantId).catch(() => null);
  const min = w.currency === 'NGN'
    ? (pr?.minTopupNgnMinor ?? 1500000)
    : (pr?.minTopupUsdMinor ?? 1000);
  if (p.data.amountMinor < min) {
    const sym = w.currency === 'NGN' ? '₦' : '$';
    throw apiError('below_minimum',
      `The smallest top-up is ${sym}${(min / 100).toLocaleString()}.`, 400);
  }
  const reference = `tlr_${randomToken(12).replace(/[^a-zA-Z0-9]/g, '').slice(0, 18)}`;
  const base = cfg.public.appBaseUrl;
  // A path of ours, never an arbitrary URL: an open redirect on a payment
  // callback is how somebody sends a paying client somewhere else entirely.
  const back = /^\/[a-zA-Z0-9/_-]{0,60}$/.test(p.data.returnTo || '') ? p.data.returnTo! : '/wallet';
  const db = useDb();

  // Ordinary sandbox top-ups stay simulated. Saving requires a provider-hosted
  // card transaction, so an explicit save request uses the configured test-mode
  // provider even while the workspace itself remains in sandbox.
  const { isSandbox } = await import('~/server/utils/sandbox');
  if (await isSandbox(s.tenantId) && !p.data.savePaymentMethod) {
    const { credit } = await import('~/server/utils/wallet');
    const r = await credit(s.tenantId, p.data.amountMinor, 'sandbox_topup', `sbx_${reference}`, { simulated: true });
    return { provider: 'sandbox', simulated: true, livemode: false, balanceMinor: r.balanceMinor, reference };
  }

  // Provider selection: an admin per-client override wins; otherwise route by
  // wallet currency (Paystack for NGN, Stripe for USD).
  const provider = pay.override || (w.currency === 'NGN' ? 'paystack' : 'stripe');

  await db.insert(schema.payments).values({
    tenantId: s.tenantId, provider,
    reference, amountMinor: p.data.amountMinor, currency: w.currency, status: 'pending',
    savePaymentMethodRequested: p.data.savePaymentMethod,
    savePaymentMethodConsentVersion: p.data.savePaymentMethod ? PAYMENT_METHOD_SAVE_CONSENT_VERSION : null,
    savePaymentMethodConsentedAt: p.data.savePaymentMethod ? new Date() : null,
    savePaymentMethodConsentedByUserId: p.data.savePaymentMethod ? s.userId : null,
    savePaymentMethodConsentedByEmail: p.data.savePaymentMethod ? s.email : null
  });

  if (provider === 'paystack') {
    if (!pay.paystack) throw apiError('not_configured', 'Paystack is not configured', 503);
    const init = await paystack.init(pay.paystack, s.email, p.data.amountMinor, reference,
      `${base}${back}?ref=${reference}`, p.data.savePaymentMethod);
    return { provider: 'paystack', ...init };
  } else if (provider === 'monnify') {
    // Monnify uses reserved bank accounts rather than a redirect checkout.
    throw apiError('use_bank_transfer', 'This account funds via bank transfer. Use the bank-transfer (reserved account) option.', 400);
  } else {
    if (!pay.stripe) throw apiError('not_configured', 'Stripe is not configured', 503);
    // Reuse the existing Stripe Customer so replacement cards and future
    // off-session charges remain attached to one customer record.
    const [saved] = await db.select({ customerId: schema.paymentMethods.providerCustomerId })
      .from(schema.paymentMethods)
      .where(and(eq(schema.paymentMethods.tenantId, s.tenantId), eq(schema.paymentMethods.provider, 'stripe')))
      .limit(1);
    const init = await stripe.init(pay.stripe, p.data.amountMinor, reference,
      `${base}${back}?ref=${reference}`, `${base}${back}`, saved?.customerId,
      p.data.savePaymentMethod);
    return { provider: 'stripe', ...init };
  }
});
