import { and, asc, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { schema, useDb } from '../db';
import { decrypt, randomToken, sha256 } from './crypto';
import { paymentCreds } from './platform';
import { autoTopupCancellationReason, cancelUnsentAutoTopups, dueUnsentAutoTopups,
  UNSENT_STATUSES, RELEASE_CLAIM, RETRY_DELAY_MS, LEASE_MS } from './auto-topup-attempts';
import { dispatchProviderCharge, paystackObservation, stripeObservation, verifyProviderCharge,
  type AutoTopupProvider, type PaymentObservation, type ProviderResult } from './auto-topup-provider';
import { creditInTransaction } from './wallet';

export interface DispatchContext {
  mode: 'test' | 'live';
  fingerprint: string;
}

type Attempt = typeof schema.autoTopupAttempts.$inferSelect;
type Payment = typeof schema.payments.$inferSelect;
type Card = typeof schema.paymentMethods.$inferSelect;
class PaymentIdentityError extends Error {}

type FinalNotification = {
  status: 'succeeded' | 'failed'; tenantId: string; amountMinor: number;
  balanceMinor: number; currency: 'USD' | 'NGN'; provider: string;
};

async function notifyFinalResult(note: FinalNotification, db: ReturnType<typeof useDb>) {
  const [tenant] = await db.select({ name: schema.tenants.name }).from(schema.tenants)
    .where(eq(schema.tenants.id, note.tenantId)).limit(1);
  const [membership] = await db.select({ userId: schema.memberships.userId }).from(schema.memberships)
    .where(and(eq(schema.memberships.tenantId, note.tenantId), eq(schema.memberships.role, 'owner'))).limit(1);
  if (!membership) return;
  const [owner] = await db.select({ email: schema.users.email }).from(schema.users)
    .where(eq(schema.users.id, membership.userId)).limit(1);
  if (!owner?.email) return;

  const symbol = note.currency === 'USD' ? '$' : '₦';
  const money = (minor: number) => `${symbol}${(minor / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
  const email = await import('./email');
  if (note.status === 'succeeded') {
    await email.sendPaymentReceivedEmail(owner.email, {
      workspace: tenant?.name || 'your workspace', amount: money(note.amountMinor),
      balance: money(note.balanceMinor), method: `automatic ${note.provider} card top-up`
    });
  } else {
    await email.sendAutoTopupFailedEmail(owner.email, {
      workspace: tenant?.name || 'your workspace', amount: money(note.amountMinor),
      balance: money(note.balanceMinor)
    });
  }
}

export function assertAutoTopupPaymentMatches(attempt: Attempt, payment: Payment): void {
  if (payment.reference !== attempt.idempotencyKey ||
      payment.tenantId !== attempt.tenantId || payment.amountMinor !== attempt.amountMinor ||
      payment.currency !== attempt.currency || payment.provider !== attempt.provider ||
      (attempt.paymentId ? attempt.paymentId !== payment.id : payment.raw?.autoTopupAttemptId !== attempt.id)) {
    throw new PaymentIdentityError('Auto top-up payment identity mismatch');
  }
}

export function assertAutoTopupObservationMatches(attempt: Attempt, observation: PaymentObservation) {
  if (!attempt.dispatchedAt || !attempt.paymentMode ||
      observation.reference !== attempt.idempotencyKey || observation.provider !== attempt.provider ||
      observation.amountMinor !== attempt.amountMinor || observation.currency !== attempt.currency ||
      observation.mode !== attempt.paymentMode ||
      (attempt.providerReference && attempt.providerReference !== observation.providerId)) {
    throw new Error('Auto top-up provider evidence mismatch');
  }
}

/** Apply provider evidence and the wallet credit in one database transaction. */
export async function settleAutoTopupObservation(
  observation: PaymentObservation,
  db = useDb()
) {
  // Find the workspace first so the transaction can lock its wallet.
  const [found] = await db
    .select({ tenantId: schema.autoTopupAttempts.tenantId })
    .from(schema.autoTopupAttempts)
    .where(eq(schema.autoTopupAttempts.idempotencyKey, observation.reference))
    .limit(1);

  if (!found) {
    return { status: 'ignored' as const };
  }

  const settled = await db.transaction(async tx => {
    // Lock all records whose financial state will be examined or changed.
    const [wallet] = await tx
      .select()
      .from(schema.wallets)
      .where(eq(schema.wallets.tenantId, found.tenantId))
      .for('update')
      .limit(1);

    const [attempt] = await tx
      .select()
      .from(schema.autoTopupAttempts)
      .where(eq(schema.autoTopupAttempts.idempotencyKey, observation.reference))
      .for('update')
      .limit(1);

    if (!wallet || !attempt || !attempt.paymentId) {
      throw new Error('Auto top-up settlement records missing');
    }

    if (!['dispatching', 'uncertain', 'needs_review', 'succeeded', 'failed'].includes(attempt.status)) {
      throw new Error('Auto top-up has not been dispatched');
    }

    const [payment] = await tx
      .select()
      .from(schema.payments)
      .where(eq(schema.payments.id, attempt.paymentId))
      .for('update')
      .limit(1);

    if (!payment) {
      throw new Error('Auto top-up payment missing');
    }

    // Provider evidence must describe this exact payment and wallet.
    assertAutoTopupPaymentMatches(attempt, payment);
    assertAutoTopupObservationMatches(attempt, observation);

    if (wallet.currency !== attempt.currency) {
      throw new Error('Auto top-up wallet currency changed');
    }

    const now = new Date();
    const release = { ...RELEASE_CLAIM, updatedAt: now };

    // Success credits the wallet and closes the payment and attempt together.
    if (observation.outcome === 'succeeded') {
      const result = await creditInTransaction(
        tx,
        attempt.tenantId,
        attempt.amountMinor,
        'auto_topup',
        attempt.idempotencyKey,
        {
          provider: attempt.provider,
          autoTopupAttemptId: attempt.id
        }
      );

      await tx
        .update(schema.payments)
        .set({
          status: 'succeeded',
          creditedAt: payment.creditedAt ?? now
        })
        .where(eq(schema.payments.id, payment.id));

      await tx
        .update(schema.autoTopupAttempts)
        .set({
          ...release,
          status: 'succeeded',
          providerReference: observation.providerId,
          succeededAt: attempt.succeededAt ?? now,
          failureCode: null,
          failureMessage: null,
          failedAt: null,
          nextAttemptAt: null,
          retryable: false
        })
        .where(eq(schema.autoTopupAttempts.id, attempt.id));

      return {
        status: 'succeeded' as const,
        idempotent: result.idempotent,
        notification: result.idempotent ? null : {
          status: 'succeeded' as const, tenantId: attempt.tenantId,
          amountMinor: attempt.amountMinor, balanceMinor: result.balanceMinor,
          currency: attempt.currency, provider: attempt.provider
        }
      };
    }

    // A late failure or pending result cannot undo an earlier success.
    if (attempt.status === 'succeeded' || payment.status === 'succeeded' || payment.creditedAt) {
      return { status: 'ignored' as const };
    }

    // A definite provider failure closes the records without a wallet credit.
    if (observation.outcome === 'failed') {
      const firstFailure = attempt.status !== 'failed' && payment.status !== 'failed';
      await tx
        .update(schema.payments)
        .set({ status: 'failed' })
        .where(eq(schema.payments.id, payment.id));

      await tx
        .update(schema.autoTopupAttempts)
        .set({
          ...release,
          status: 'failed',
          retryable: false,
          providerReference: observation.providerId,
          failedAt: attempt.failedAt ?? now,
          failureCode: observation.code,
          nextAttemptAt: null
        })
        .where(eq(schema.autoTopupAttempts.id, attempt.id));

      return {
        status: 'failed' as const,
        notification: firstFailure ? {
          status: 'failed' as const, tenantId: attempt.tenantId,
          amountMinor: attempt.amountMinor, balanceMinor: wallet.balanceMinor,
          currency: attempt.currency, provider: attempt.provider
        } : null
      };
    }

    if (attempt.status === 'failed') {
      return { status: 'ignored' as const };
    }

    // An inconclusive result permits a later lookup, never another charge POST.
    await tx
      .update(schema.autoTopupAttempts)
      .set({
        ...release,
        status: 'uncertain',
        providerReference: observation.providerId,
        failureCode: observation.code,
        retryable: false,
        nextAttemptAt: new Date(now.getTime() + RETRY_DELAY_MS)
      })
      .where(eq(schema.autoTopupAttempts.id, attempt.id));

    return { status: 'uncertain' as const };
  });

  // Financial state is already committed. A mail-provider failure is logged
  // but can never roll back credit or turn a decline into another charge.
  if ('notification' in settled && settled.notification) {
    try { await notifyFinalResult(settled.notification, db); }
    catch (error: any) { console.error('[auto-topup] customer email failed:', error?.message); }
  }
  return settled.status === 'succeeded'
    ? { status: settled.status, idempotent: settled.idempotent }
    : { status: settled.status };
}

export async function markAutoTopupUncertain(id: string, claimToken: string, code: string, db = useDb()) {
  const now = new Date();
  await db.update(schema.autoTopupAttempts).set({ status: 'uncertain', retryable: false,
    failureCode: code, updatedAt: now, nextAttemptAt: new Date(now.getTime() + RETRY_DELAY_MS),
    claimToken: null, claimedAt: null, leaseExpiresAt: null
  }).where(and(eq(schema.autoTopupAttempts.id, id), eq(schema.autoTopupAttempts.claimToken, claimToken),
    inArray(schema.autoTopupAttempts.status, ['dispatching', 'uncertain'])));
}

/** Route authenticated provider webhooks into the auto top-up settlement path. */
export async function reconcileAutoTopupWebhook(provider: AutoTopupProvider, payload: unknown, db = useDb()) {
  const observation = provider === 'stripe' ? stripeObservation(payload) : paystackObservation(payload);
  const object = payload as { reference?: unknown; metadata?: { reference?: unknown } } | null;
  const reference = provider === 'stripe' ? object?.metadata?.reference : object?.reference;
  if (typeof reference !== 'string' || !reference.startsWith('atp-')) return null;
  if (observation.outcome === 'unknown') throw new Error('Invalid auto top-up webhook evidence');
  const result = await settleAutoTopupObservation(observation, db);
  if (result.status === 'ignored') {
    const [attempt] = await db.select({ id: schema.autoTopupAttempts.id }).from(schema.autoTopupAttempts)
      .where(eq(schema.autoTopupAttempts.idempotencyKey, reference)).limit(1);
    if (!attempt) throw new Error('Auto top-up webhook attempt missing');
  }
  return result;
}

export function autoTopupCardProblem(card: Card, attempt: Attempt, now: Date): string | null {
  if (card.updatedAt > attempt.createdAt) return 'payment_method_changed';
  if (!card.expMonth || !card.expYear || card.expMonth < 1 || card.expMonth > 12) return 'card_expiry_missing';
  if (Date.UTC(card.expYear, card.expMonth, 1) <= now.getTime()) return 'card_expired';
  if (card.provider === 'stripe' && !card.providerCustomerId) return 'customer_missing';
  if (card.provider === 'paystack' && !card.billingEmail) return 'billing_email_missing';
  return null;
}

/** Final check and exclusive claim immediately before the provider call. */
export async function claimAutoTopupForCharge(
  tenantId: string,
  attemptId: string,
  dispatch: DispatchContext,
  db: ReturnType<typeof useDb> = useDb()
) {
  return db.transaction(async tx => {
    await tx.execute(sql`select set_config('lock_timeout', '3s', true), set_config('statement_timeout', '10s', true)`);
    const now = new Date();
    const [wallet] = await tx.select().from(schema.wallets)
      .where(eq(schema.wallets.tenantId, tenantId)).for('update', { skipLocked: true }).limit(1);
    if (!wallet) return { status: 'skipped' as const };
    const [attempt] = await tx.select().from(schema.autoTopupAttempts)
      .where(and(eq(schema.autoTopupAttempts.id, attemptId), eq(schema.autoTopupAttempts.tenantId, tenantId), dueUnsentAutoTopups(now)))
      .for('update').limit(1);
    if (!attempt || !UNSENT_STATUSES.includes(attempt.status as typeof UNSENT_STATUSES[number])) return { status: 'skipped' as const };
    const review = async (code: string) => {
      await tx.update(schema.autoTopupAttempts).set({ ...RELEASE_CLAIM, status: 'needs_review',
        failureCode: code, retryable: false, nextAttemptAt: null, updatedAt: now
      }).where(eq(schema.autoTopupAttempts.id, attempt.id));
      return { status: 'needs_review' as const };
    };
    if (attempt.attempts > 0 || attempt.dispatchedAt || attempt.lastAttemptAt || attempt.providerReference) {
      return review('unexpected_dispatch_evidence');
    }

    const [existing] = await tx.select().from(schema.payments)
      .where(eq(schema.payments.reference, attempt.idempotencyKey)).for('update').limit(1);
    if (existing) {
      try { assertAutoTopupPaymentMatches(attempt, existing); }
      catch (error) { if (error instanceof PaymentIdentityError) return review('payment_identity_mismatch'); throw error; }
      if (existing.status !== 'pending' || existing.creditedAt) return review('unexpected_payment_result');
    } else if (attempt.paymentId) return review('linked_payment_missing');

    const [tenant] = await tx.select().from(schema.tenants)
      .where(eq(schema.tenants.id, tenantId)).for('share').limit(1);
    const [settings] = await tx.select().from(schema.autoTopupSettings)
      .where(eq(schema.autoTopupSettings.tenantId, tenantId)).for('share').limit(1);
    const [card] = attempt.paymentMethodId ? await tx.select().from(schema.paymentMethods)
      .where(and(eq(schema.paymentMethods.id, attempt.paymentMethodId), eq(schema.paymentMethods.tenantId, tenantId)))
      .for('share').limit(1) : [];
    let reason: string | null = autoTopupCancellationReason(attempt, {
      tenant: tenant ?? null, wallet: wallet ?? null, settings: settings ?? null, card: card ?? null
    });
    if (!reason && tenant?.closedAt) reason = 'workspace_closed';
    if (!reason && tenant?.billingSuspendedAt) reason = 'workspace_suspended';
    if (!reason && card) reason = autoTopupCardProblem(card, attempt, now);
    if (!reason) {
      const [pricing] = await tx.select().from(schema.pricing).where(eq(schema.pricing.id, 'singleton')).limit(1);
      const minimum = attempt.currency === 'USD' ? pricing?.minTopupUsdMinor ?? 1000 : pricing?.minTopupNgnMinor ?? 1500000;
      if (!Number.isInteger(attempt.amountMinor) || attempt.amountMinor < minimum) reason = 'below_minimum';
    }
    if (reason) {
      await cancelUnsentAutoTopups(tx, tenantId, reason, attempt.id);
      return { status: 'cancelled' as const, reason };
    }
    if (!card?.tokenEnc) throw new Error('Saved card token unavailable');
    const token = decrypt(card.tokenEnc);
    if (!token) throw new Error('Saved card token unavailable');

    let payment = existing;
    if (!payment) {
      const [inserted] = await tx.insert(schema.payments).values({
        tenantId, reference: attempt.idempotencyKey, provider: attempt.provider,
        amountMinor: attempt.amountMinor, currency: attempt.currency, status: 'pending',
        raw: { source: 'auto_topup', autoTopupAttemptId: attempt.id }
      }).onConflictDoNothing({ target: schema.payments.reference }).returning();
      payment = inserted;
      if (!payment) {
        const [conflicting] = await tx.select().from(schema.payments)
          .where(eq(schema.payments.reference, attempt.idempotencyKey)).for('update').limit(1);
        payment = conflicting;
      }
    }
    if (!payment) throw new Error('Pending auto top-up payment was not recorded');
    try { assertAutoTopupPaymentMatches(attempt, payment); }
    catch (error) { if (error instanceof PaymentIdentityError) return review('payment_identity_mismatch'); throw error; }
    if (payment.status !== 'pending' || payment.creditedAt) return review('unexpected_payment_result');

    const claimToken = randomToken(24);
    await tx.update(schema.autoTopupAttempts).set({
      paymentId: payment.id, status: 'dispatching', dispatchedAt: now,
      attempts: 1, lastAttemptAt: now, validatedAt: now, updatedAt: now,
      paymentMode: dispatch.mode, credentialFingerprint: dispatch.fingerprint,
      claimToken, claimedAt: now, leaseExpiresAt: new Date(now.getTime() + LEASE_MS),
      nextAttemptAt: new Date(now.getTime() + LEASE_MS)
    }).where(eq(schema.autoTopupAttempts.id, attempt.id));
    return { status: 'dispatch' as const, attemptId: attempt.id, tenantId, claimToken,
      paymentId: payment.id, reference: payment.reference, amountMinor: payment.amountMinor,
      currency: payment.currency, provider: payment.provider, token,
      customerId: card.providerCustomerId, billingEmail: card.billingEmail };
  });
}

export function autoTopupCredentialContext(provider: string, credentials: Awaited<ReturnType<typeof paymentCreds>>) {
  if (provider !== 'stripe' && provider !== 'paystack') throw new Error('Unsupported auto top-up provider');
  const secret = credentials[provider];
  if (typeof secret !== 'string' || !secret) throw new Error('Auto top-up provider key missing');
  const prefix = provider === 'stripe' ? /^(sk|rk)_(test|live)_/ : /^sk_(test|live)_/;
  const keyMode = secret.match(prefix)?.at(-1);
  if (keyMode !== credentials.mode) throw new Error('Auto top-up provider mode mismatch');
  return { provider: provider as AutoTopupProvider, secret, mode: credentials.mode,
    fingerprint: sha256(secret) };
}

/** Recovery claims never grant dispatch permission. They are GET-only even
 * when the original process crashed immediately before making its POST. */
export async function claimAutoTopupRecovery(db = useDb(), now = new Date()) {
  return db.transaction(async tx => {
    const [attempt] = await tx.select().from(schema.autoTopupAttempts).where(and(
      inArray(schema.autoTopupAttempts.status, ['dispatching', 'uncertain']),
      or(isNull(schema.autoTopupAttempts.nextAttemptAt), lte(schema.autoTopupAttempts.nextAttemptAt, now)),
      or(isNull(schema.autoTopupAttempts.leaseExpiresAt), lte(schema.autoTopupAttempts.leaseExpiresAt, now))
    )).orderBy(asc(schema.autoTopupAttempts.nextAttemptAt), asc(schema.autoTopupAttempts.id))
      .for('update', { skipLocked: true }).limit(1);
    if (!attempt) return null;
    const [claimed] = await tx.update(schema.autoTopupAttempts).set({ claimToken: randomToken(24),
      claimedAt: now, leaseExpiresAt: new Date(now.getTime() + LEASE_MS), updatedAt: now
    }).where(eq(schema.autoTopupAttempts.id, attempt.id)).returning();
    return claimed ?? null;
  });
}

async function recordResult(id: string, claimToken: string, result: ProviderResult, db: ReturnType<typeof useDb>) {
  if (result.outcome === 'unknown') {
    await markAutoTopupUncertain(id, claimToken, result.code, db);
    return 'uncertain' as const;
  }
  const settled = await settleAutoTopupObservation(result, db);
  if (settled.status === 'ignored') {
    // Could be a stale result after successful settlement, or a mismatched
    // reference. The conditional update cannot change a settled attempt.
    await markAutoTopupUncertain(id, claimToken, 'result_not_applied', db);
  }
  return settled.status;
}

/** Each phase uses a bounded number of concurrent tasks and stops taking work
 * at the deadline. HTTP requests have their own timeout. No request is detached.
 */
export async function executeAutoTopups(
  options: { enabled: boolean; batchSize?: number; concurrency?: number; timeBudgetMs?: number }, db = useDb()
) {
  const limit = (value: number | undefined, fallback: number, max: number) =>
    Number.isFinite(value) ? Math.max(1, Math.min(max, Math.trunc(value!))) : fallback;
  const batch = limit(options.batchSize, 20, 100);
  const concurrency = limit(options.concurrency, 4, 4);
  const deadline = Date.now() + limit(options.timeBudgetMs, 45_000, 45_000);
  const counts = { dispatched: 0, recovered: 0, succeeded: 0, failed: 0, uncertain: 0,
    ignored: 0, cancelled: 0, skipped: 0, needs_review: 0, errors: 0 };
  const run = async <T>(items: T[], task: (item: T) => Promise<void>, stopAt = deadline) => {
    let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (cursor < items.length && Date.now() < stopAt) {
        try { await task(items[cursor++]!); }
        catch { counts.errors++; console.error('[auto-topup] could not persist worker result'); }
      }
    }));
  };
  await run(Array.from({ length: batch }), async () => {
    let attempt: Attempt | null = null;
    try {
      attempt = await claimAutoTopupRecovery(db);
      if (!attempt?.claimToken) return;
      const context = autoTopupCredentialContext(attempt.provider, await paymentCreds(attempt.tenantId));
      if (context.mode !== attempt.paymentMode || context.fingerprint !== attempt.credentialFingerprint) {
        await markAutoTopupUncertain(attempt.id, attempt.claimToken, 'credential_context_changed', db);
        counts.uncertain++; return;
      }
      const result = await verifyProviderCharge({ ...context,
        reference: attempt.idempotencyKey, providerId: attempt.providerReference });
      if (result.outcome !== 'unknown' && result.reference !== attempt.idempotencyKey) throw new PaymentIdentityError();
      counts[await recordResult(attempt.id, attempt.claimToken, result, db)]++;
      counts.recovered++;
    } catch {
      counts.errors++;
      if (attempt?.claimToken) await markAutoTopupUncertain(attempt.id, attempt.claimToken, 'reconciliation_error', db);
      console.error('[auto-topup] reconciliation failed', attempt?.id);
    }
  }, Math.min(deadline, Date.now() + 20_000));
  if (!options.enabled || Date.now() >= deadline) return counts;
  const rows = await db.select({ id: schema.autoTopupAttempts.id, tenantId: schema.autoTopupAttempts.tenantId,
    provider: schema.autoTopupAttempts.provider }).from(schema.autoTopupAttempts).where(dueUnsentAutoTopups())
    .orderBy(asc(schema.autoTopupAttempts.nextAttemptAt), asc(schema.autoTopupAttempts.id)).limit(batch);
  await run(rows, async row => {
    let claimToken: string | undefined;
    try {
      const context = autoTopupCredentialContext(row.provider, await paymentCreds(row.tenantId));
      const claimed = await claimAutoTopupForCharge(row.tenantId, row.id, context, db);
      if (claimed.status !== 'dispatch') { counts[claimed.status]++; return; }
      claimToken = claimed.claimToken;
      counts.dispatched++;
      const result = await dispatchProviderCharge({ ...claimed, provider: context.provider, secret: context.secret });
      if (result.outcome !== 'unknown' && result.reference !== claimed.reference) throw new PaymentIdentityError();
      counts[await recordResult(row.id, claimToken, result, db)]++;
    } catch {
      counts.errors++;
      if (claimToken) await markAutoTopupUncertain(row.id, claimToken, 'dispatch_result_unconfirmed', db);
      else await db.update(schema.autoTopupAttempts).set({ updatedAt: new Date(),
        nextAttemptAt: new Date(Date.now() + RETRY_DELAY_MS), failureCode: 'dispatch_preparation_error'
      }).where(and(eq(schema.autoTopupAttempts.id, row.id), dueUnsentAutoTopups()));
      console.error('[auto-topup] execution failed', row.id);
    }
  });
  return counts;
}
