// POST /api/webhooks/paystack — verified credit path for NGN top-ups.
// Public endpoint; authenticated by Paystack's HMAC-SHA512 signature, NOT a session.
import { eq } from 'drizzle-orm';
import { useDb, schema } from '~/server/db';
import { paystack } from '~/server/utils/payments';
import { paymentCreds } from '~/server/utils/platform';
import { credit } from '~/server/utils/wallet';
import { canSavePaymentMethod, paystackReusableCard, saveVerifiedPaymentMethod } from '~/server/utils/payment-methods';
import { reconcileAutoTopupWebhook } from '~/server/utils/auto-topup-executor';

export default defineEventHandler(async (event) => {
  const raw = await readRawBody(event) || '';
  const sig = getRequestHeader(event, 'x-paystack-signature') || '';
  const pay = await paymentCreds();

  // Recorded before verification: a refused notification and one that never
  // arrived look identical otherwise.
  const { recordWebhook, finishWebhook } = await import('~/server/utils/webhook-log');
  const logId = await recordWebhook({ provider: 'paystack', raw });

  if (!pay.paystack || !paystack.verifySignature(pay.paystack, raw, sig)) {
    await finishWebhook(logId, {
      outcome: 'rejected', signatureOk: false,
      detail: !pay.paystack ? 'no Paystack key configured for the current payment mode' : 'signature did not verify'
    });
    throw createError({ statusCode: 401, message: 'Invalid signature' });
  }

  const body = JSON.parse(raw);
  if (body.event !== 'charge.success') {
    await finishWebhook(logId, { outcome: 'ignored', signatureOk: true, eventType: body.event, detail: 'not a successful charge' });
    return { ok: true, ignored: body.event };
  }

  const reference = body.data?.reference;
  const autoTopup = await reconcileAutoTopupWebhook('paystack', body.data);
  if (autoTopup) {
    await finishWebhook(logId, { outcome: 'accepted', signatureOk: true, eventType: body.event,
      detail: `auto top-up ${autoTopup.status}` });
    return { ok: true, ...autoTopup };
  }
  const db = useDb();
  const [payment] = await db.select().from(schema.payments).where(eq(schema.payments.reference, reference)).limit(1);
  if (!payment) {
    await finishWebhook(logId, { outcome: 'ignored', signatureOk: true, eventType: body.event,
      detail: `no payment found for ${reference}` });
    return { ok: true, idempotent: true };
  }
  const paidAmount = Number(body.data?.amount);
  const paidCurrency = String(body.data?.currency || '').toUpperCase();
  if (payment.provider !== 'paystack' || paidAmount !== payment.amountMinor || paidCurrency !== payment.currency) {
    await finishWebhook(logId, { outcome: 'rejected', signatureOk: true, eventType: body.event,
      tenantId: payment.tenantId, detail: 'payment provider, amount, or currency did not match' });
    throw createError({ statusCode: 400, message: 'Payment details do not match' });
  }

  // A reusable authorization is saved only when this exact payment records the
  // owner's choice. Successful bank and transfer payments are still credited.
  if (canSavePaymentMethod(payment)) {
    try {
      const auth = paystackReusableCard(body.data?.authorization);
      const billingEmail = body.data?.customer?.email;
      // This release supports saved cards only. Direct-debit mandates need their
      // own activation/revocation lifecycle and must not be mislabeled as cards.
      if (auth && typeof billingEmail === 'string' && billingEmail) {
        await saveVerifiedPaymentMethod({
          tenantId: payment.tenantId, provider: 'paystack', token: auth.authorization_code,
          sourcePaymentReference: payment.reference, sourcePaymentCreatedAt: payment.createdAt,
          billingEmail, providerSignature: auth.signature || null,
          brand: auth.card_type || auth.brand || null, last4: auth.last4 || null,
          expMonth: auth.exp_month ? Number(auth.exp_month) : null,
          expYear: auth.exp_year ? Number(auth.exp_year) : null
        });
      }
    } catch (e: any) {
      // A card-save failure must not fail or hide the payment that already moved.
      console.error('[paystack] reusable card save failed:', e?.message);
    }
  }

  // A duplicate webhook should retry card persistence above, but never credit
  // the already-settled payment a second time.
  if (payment.status === 'succeeded') {
    await finishWebhook(logId, { outcome: 'ignored', signatureOk: true, eventType: body.event,
      tenantId: payment.tenantId, detail: 'already credited' });
    return { ok: true, idempotent: true };
  }

  // Credit the wallet (idempotent by reference) and mark the payment settled.
  await credit(payment.tenantId, payment.amountMinor, 'topup', reference, { provider: 'paystack' });
  await finishWebhook(logId, { outcome: 'accepted', signatureOk: true, eventType: body.event,
    tenantId: payment.tenantId, detail: `credited ${(payment.amountMinor / 100).toLocaleString()}` });
  const storedBody = structuredClone(body);
  if (storedBody.data?.authorization?.authorization_code) {
    storedBody.data.authorization.authorization_code = '[redacted]';
  }
  await db.update(schema.payments).set({ status: 'succeeded', creditedAt: new Date(), raw: storedBody })
    .where(eq(schema.payments.id, payment.id));

  return { ok: true };
});
