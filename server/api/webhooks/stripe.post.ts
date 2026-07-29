// POST /api/webhooks/stripe — verified credit path for USD top-ups.
import { eq } from 'drizzle-orm';
import { useDb, schema } from '~/server/db';
import { stripe } from '~/server/utils/payments';
import { credit } from '~/server/utils/wallet';

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
  if (!stripe.verifySignature(pay.stripeWebhookSecret, raw, sig)) {
    throw createError({ statusCode: 401, message: 'Invalid signature' });
  }

  const body = JSON.parse(raw);
  if (body.type !== 'checkout.session.completed') return { ok: true, ignored: body.type };

  const session = body.data?.object || {};
  const reference = session.client_reference_id || session.metadata?.reference;
  if (session.payment_status !== 'paid') return { ok: true, unpaid: true };

  const db = useDb();
  const [payment] = await db.select().from(schema.payments).where(eq(schema.payments.reference, reference)).limit(1);
  if (!payment || payment.status === 'succeeded') return { ok: true, idempotent: true };

  await credit(payment.tenantId, payment.amountMinor, 'topup', reference, { provider: 'stripe' });
  await db.update(schema.payments).set({ status: 'succeeded', creditedAt: new Date(), raw: body })
    .where(eq(schema.payments.id, payment.id));
  return { ok: true };
});
