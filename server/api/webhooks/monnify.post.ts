// Monnify webhook — credits the wallet when a transfer lands in the reserved
// account. Authenticated by the 'monnify-signature' HMAC-SHA512 of the raw body.
import { eq } from 'drizzle-orm';
import { useDb, schema } from '~/server/db';
import { monnify } from '~/server/utils/monnify';
import { paymentCreds } from '~/server/utils/platform';
import { credit } from '~/server/utils/wallet';

export default defineEventHandler(async (event) => {
  const raw = (await readRawBody(event)) || '';
  const sig = getRequestHeader(event, 'monnify-signature') || '';
  const pay = await paymentCreds();

  // Recorded before verification: a refused notification and one that never
  // arrived look identical otherwise, and telling them apart is most of the work
  // when a payment doesn't land.
  const { recordWebhook, finishWebhook } = await import('~/server/utils/webhook-log');
  const logId = await recordWebhook({ provider: 'monnify', raw });

  if (!pay.monnify?.secretKey || !monnify.verifySignature(pay.monnify.secretKey, raw, sig)) {
    await finishWebhook(logId, {
      outcome: 'rejected', signatureOk: false,
      detail: !pay.monnify?.secretKey ? 'no Monnify secret configured' : (sig ? 'signature did not verify' : 'no signature header')
    });
    throw createError({ statusCode: 401, message: 'Invalid signature' });
  }

  const body = JSON.parse(raw);
  const evType = body.eventType || body.eventData?.paymentStatus;
  const data = body.eventData || body;
  // Only act on a successful, paid transaction.
  const paid = evType === 'SUCCESSFUL_TRANSACTION' || data.paymentStatus === 'PAID';
  if (!paid) return { ok: true, ignored: evType };

  // Match the reserved account to a workspace via product.reference (account ref).
  const accountRef = data.product?.reference || data.destinationAccountInformation?.accountReference;
  if (!accountRef) {
    await finishWebhook(logId, { outcome: 'ignored', signatureOk: true, detail: 'no account reference in payload', eventType: evType });
    return { ok: true, note: 'no account reference' };
  }

  const db = useDb();
  const [va] = await db.select().from(schema.virtualAccounts)
    .where(eq(schema.virtualAccounts.accountReference, accountRef)).limit(1);
  if (!va) {
    await finishWebhook(logId, { outcome: 'ignored', signatureOk: true, detail: `no workspace holds account ${accountRef}`, eventType: evType });
    return { ok: true, note: 'unknown account' };
  }

  // amountPaid is in naira (major). Wallet is kobo (minor). Use the txn ref as
  // the idempotency key so a re-sent webhook never double-credits.
  const naira = Number(data.amountPaid || 0);
  if (!naira || naira <= 0) {
    await finishWebhook(logId, { outcome: 'ignored', signatureOk: true, tenantId: va.tenantId, detail: 'zero amount', eventType: evType });
    return { ok: true, note: 'zero amount' };
  }
  const kobo = Math.round(naira * 100);
  const reference = data.transactionReference || data.paymentReference;

  await credit(va.tenantId, kobo, 'topup', `monnify_${reference}`, { provider: 'monnify', accountRef });
  // Record the payment for audit.
  await db.insert(schema.payments).values({
    tenantId: va.tenantId, provider: 'monnify', reference: `monnify_${reference}`,
    amountMinor: kobo, currency: 'NGN', status: 'succeeded', creditedAt: new Date(), raw: body
  }).onConflictDoNothing();

  await finishWebhook(logId, {
    outcome: 'accepted', signatureOk: true, tenantId: va.tenantId,
    detail: `credited ₦${naira.toLocaleString()}`, eventType: evType
  });
  return { ok: true };
});
