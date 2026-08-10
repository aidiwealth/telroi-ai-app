// POST /api/webhooks/paystack — verified credit path for NGN top-ups.
// Public endpoint; authenticated by Paystack's HMAC-SHA512 signature, NOT a session.
import { eq } from 'drizzle-orm';
import { useDb, schema } from '~/server/db';
import { paystack } from '~/server/utils/payments';
import { paymentCreds } from '~/server/utils/platform';
import { credit } from '~/server/utils/wallet';

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
  const db = useDb();
  const [payment] = await db.select().from(schema.payments).where(eq(schema.payments.reference, reference)).limit(1);
  if (!payment || payment.status === 'succeeded') {
    await finishWebhook(logId, { outcome: 'ignored', signatureOk: true, eventType: body.event,
      tenantId: payment?.tenantId, detail: payment ? 'already credited' : `no payment found for ${reference}` });
    return { ok: true, idempotent: true };
  }

  // Credit the wallet (idempotent by reference) and mark the payment settled.
  await credit(payment.tenantId, payment.amountMinor, 'topup', reference, { provider: 'paystack' });
  await finishWebhook(logId, { outcome: 'accepted', signatureOk: true, eventType: body.event,
    tenantId: payment.tenantId, detail: `credited ${(payment.amountMinor / 100).toLocaleString()}` });
  await db.update(schema.payments).set({ status: 'succeeded', creditedAt: new Date(), raw: body })
    .where(eq(schema.payments.id, payment.id));

  // Paystack hands back a reusable authorization on every successful charge, and
  // we were throwing it away — so "add a payment method" was a setup step nobody
  // could ever complete, and auto-top-up had nothing to charge. Taking it here
  // means a client's first top-up leaves a card on file as a by-product, with no
  // separate form and no card number ever reaching us.
  try {
    const auth = body.data?.authorization;
    if (auth?.authorization_code && auth?.reusable !== false) {
      await db.delete(schema.paymentMethods).where(eq(schema.paymentMethods.tenantId, payment.tenantId));
      await db.insert(schema.paymentMethods).values({
        tenantId: payment.tenantId, provider: 'paystack', token: auth.authorization_code,
        brand: auth.card_type || auth.brand || null, last4: auth.last4 || null,
        expMonth: auth.exp_month ? Number(auth.exp_month) : null,
        expYear: auth.exp_year ? Number(auth.exp_year) : null, isDefault: true
      });
    }
  } catch { /* a card we couldn't keep shouldn't fail the payment that worked */ }

  return { ok: true };
});
