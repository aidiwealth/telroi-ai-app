// POST /api/webhooks/stripe — verified credit path for USD top-ups.
import { eq } from 'drizzle-orm';
import { useDb, schema } from '~/server/db';
import { stripe } from '~/server/utils/payments';
import { credit } from '~/server/utils/wallet';
import { canSavePaymentMethod, saveVerifiedPaymentMethod } from '~/server/utils/payment-methods';
import { reconcileAutoTopupWebhook } from '~/server/utils/auto-topup-executor';

export default defineEventHandler(async (event) => {
  const raw = await readRawBody(event) || '';
  const sig = getRequestHeader(event, 'stripe-signature') || '';
  const { paymentCreds } = await import('~/server/utils/platform');
  const pay = await paymentCreds();

  // Say which of the two it is. A missing secret and a forged request looked
  // identical, so a Stripe payment could complete, sit uncredited, and give no
  // indication anywhere that the endpoint simply had nothing to verify against.
  if (!pay.stripeWebhookSecret) {
    console.error('[stripe] webhook rejected: no signing secret configured for this mode');
    throw createError({ statusCode: 401, message: 'Stripe webhook signing secret is not configured' });
  }
  const { recordWebhook, finishWebhook } = await import('~/server/utils/webhook-log');
  const logId = await recordWebhook({ provider: 'stripe', raw });

  if (!stripe.verifySignature(pay.stripeWebhookSecret, raw, sig)) {
    await finishWebhook(logId, { outcome: 'rejected', signatureOk: false, detail: 'signature did not verify' });
    throw createError({ statusCode: 401, message: 'Invalid signature' });
  }

  const body = JSON.parse(raw);
  if (['payment_intent.succeeded', 'payment_intent.payment_failed', 'payment_intent.processing',
    'payment_intent.requires_action', 'payment_intent.canceled'].includes(body.type)) {
    const result = await reconcileAutoTopupWebhook('stripe', body.data?.object);
    if (result) {
      await finishWebhook(logId, { outcome: 'accepted', signatureOk: true, eventType: body.type,
        detail: `auto top-up ${result.status}` });
      return { ok: true, ...result };
    }
  }
  if (body.type !== 'checkout.session.completed') {
    await finishWebhook(logId, { outcome: 'ignored', signatureOk: true, eventType: body.type });
    return { ok: true, ignored: body.type };
  }

  const session = body.data?.object || {};
  const reference = session.client_reference_id || session.metadata?.reference;
  if (typeof reference === 'string' && reference.startsWith('atp-')) {
    throw createError({ statusCode: 400, message: 'Auto top-up requires PaymentIntent evidence' });
  }
  if (session.payment_status !== 'paid') {
    await finishWebhook(logId, { outcome: 'ignored', signatureOk: true, eventType: body.type, detail: `session ${session.payment_status}` });
    return { ok: true, unpaid: true };
  }

  const db = useDb();
  const [payment] = await db.select().from(schema.payments).where(eq(schema.payments.reference, reference)).limit(1);
  if (!payment) {
    await finishWebhook(logId, { outcome: 'ignored', signatureOk: true, eventType: body.type,
      detail: `no payment found for ${reference}` });
    return { ok: true, idempotent: true };
  }
  const paidAmount = Number(session.amount_total);
  const paidCurrency = String(session.currency || '').toUpperCase();
  if (payment.provider !== 'stripe' || paidAmount !== payment.amountMinor || paidCurrency !== payment.currency) {
    await finishWebhook(logId, { outcome: 'rejected', signatureOk: true, eventType: body.type,
      tenantId: payment.tenantId, detail: 'payment provider, amount, or currency did not match' });
    throw createError({ statusCode: 400, message: 'Payment details do not match' });
  }

  // A successful payment proves that the card worked; it does not prove the
  // owner asked us to retain it. The pending payment is the consent boundary.
  if (canSavePaymentMethod(payment)) {
    try {
      if (pay.stripe && session.payment_intent) {
        const intent = await stripe.retrievePaymentIntent(pay.stripe,
          typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent.id);
        const method = intent?.payment_method;
        const methodId = typeof method === 'string' ? method : method?.id;
        const customerId = typeof session.customer === 'string'
          ? session.customer
          : session.customer?.id || (typeof intent?.customer === 'string' ? intent.customer : intent?.customer?.id);
        if (methodId) {
          await saveVerifiedPaymentMethod({
            tenantId: payment.tenantId,
            provider: 'stripe',
            token: methodId,
            sourcePaymentReference: payment.reference,
            sourcePaymentCreatedAt: payment.createdAt,
            providerCustomerId: customerId || null,
            billingEmail: session.customer_details?.email || session.customer_email || null,
            brand: method?.card?.brand || null,
            last4: method?.card?.last4 || null,
            expMonth: method?.card?.exp_month || null,
            expYear: method?.card?.exp_year || null
          });
        }
      }
    } catch (e: any) {
      // Wallet settlement remains independent of retaining the card.
      console.error('[stripe] reusable card save failed:', e?.message);
    }
  }

  if (payment.status === 'succeeded') {
    await finishWebhook(logId, { outcome: 'ignored', signatureOk: true, eventType: body.type,
      tenantId: payment.tenantId, detail: 'already credited' });
    return { ok: true, idempotent: true };
  }

  await credit(payment.tenantId, payment.amountMinor, 'topup', reference, { provider: 'stripe' });
  await finishWebhook(logId, { outcome: 'accepted', signatureOk: true, eventType: body.type,
    tenantId: payment.tenantId, detail: `credited ${(payment.amountMinor / 100).toLocaleString()}` });
  await db.update(schema.payments).set({ status: 'succeeded', creditedAt: new Date(), raw: body })
    .where(eq(schema.payments.id, payment.id));
  return { ok: true };
});
