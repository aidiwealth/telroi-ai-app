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

  if (!pay.paystack || !paystack.verifySignature(pay.paystack, raw, sig)) {
    throw createError({ statusCode: 401, message: 'Invalid signature' });
  }

  const body = JSON.parse(raw);
  if (body.event !== 'charge.success') return { ok: true, ignored: body.event };

  const reference = body.data?.reference;
  const db = useDb();
  const [payment] = await db.select().from(schema.payments).where(eq(schema.payments.reference, reference)).limit(1);
  if (!payment || payment.status === 'succeeded') return { ok: true, idempotent: true };

  // Credit the wallet (idempotent by reference) and mark the payment settled.
  await credit(payment.tenantId, payment.amountMinor, 'topup', reference, { provider: 'paystack' });
  await db.update(schema.payments).set({ status: 'succeeded', creditedAt: new Date(), raw: body })
    .where(eq(schema.payments.id, payment.id));
  return { ok: true };
});
