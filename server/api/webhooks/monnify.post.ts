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

  // The client secret is the webhook signing key.
  if (!pay.monnify?.secretKey || !monnify.verifySignature(pay.monnify.secretKey, raw, sig)) {
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
  if (!accountRef) return { ok: true, note: 'no account reference' };

  const db = useDb();
  const [va] = await db.select().from(schema.virtualAccounts)
    .where(eq(schema.virtualAccounts.accountReference, accountRef)).limit(1);
  if (!va) return { ok: true, note: 'unknown account' };

  // amountPaid is in naira (major). Wallet is kobo (minor). Use the txn ref as
  // the idempotency key so a re-sent webhook never double-credits.
  const naira = Number(data.amountPaid || 0);
  if (!naira || naira <= 0) return { ok: true, note: 'zero amount' };
  const kobo = Math.round(naira * 100);
  const reference = data.transactionReference || data.paymentReference;

  await credit(va.tenantId, kobo, 'topup', `monnify_${reference}`, { provider: 'monnify', accountRef });
  // Record the payment for audit.
  await db.insert(schema.payments).values({
    tenantId: va.tenantId, provider: 'monnify', reference: `monnify_${reference}`,
    amountMinor: kobo, currency: 'NGN', status: 'succeeded', creditedAt: new Date(), raw: body
  }).onConflictDoNothing();

  return { ok: true };
});
