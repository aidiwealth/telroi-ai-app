import { and, eq, inArray, isNull, lte, ne, notExists, or, isNotNull } from 'drizzle-orm';
import { schema, type DbTransaction } from '../db';
import { STRIPE_MAX_AMOUNT_MINOR } from './payments';

export const AUTO_TOPUP_CONSENT_VERSION = '2026-09-08';
export const AUTO_TOPUP_CONSENT_TEXT =
  'When the wallet crosses below the configured threshold, charge the selected saved card by the configured refill amount. This remains enabled until a workspace owner disables it.';

/** Stripe currently serves USD wallets; Paystack serves NGN wallets. */
export function providerSupportsWalletCurrency(provider: string, currency: string): boolean {
  return (provider === 'stripe' && currency === 'USD')
    || (provider === 'paystack' && currency === 'NGN');
}

/** Create work only when a debit moves the wallet from above to below its limit. */
export function crossedAutoTopupThreshold(before: number, after: number, threshold: number): boolean {
  return before >= threshold && after < threshold;
}

export interface EnqueueAutoTopupAttemptInput {
  tenantId: string;
  triggerLedgerId: string;
  paymentMethodId: string;
  amountMinor: number;
  currency: 'NGN' | 'USD';
  balanceAtTriggerMinor: number;
  provider: 'stripe' | 'paystack';
}

type Attempt = typeof schema.autoTopupAttempts.$inferSelect;

/** Stable across process restarts and retries; also suitable for the payment
 * provider's idempotency header/reference when this attempt is processed. */
export function autoTopupAttemptKey(triggerLedgerId: string): string {
  // Paystack references have a narrower character set than Stripe idempotency
  // keys. This form is safe to reuse with either provider.
  return `atp-${triggerLedgerId}`;
}

/** Called inside the debit transaction while holding the workspace wallet lock. */
export async function enqueueAutoTopupAttemptWithDb(db: DbTransaction, input: EnqueueAutoTopupAttemptInput) {
  if (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0) {
    throw new Error('Auto top-up amount must be a positive integer.');
  }
  if (!Number.isInteger(input.balanceAtTriggerMinor)) {
    throw new Error('Trigger balance must be an integer.');
  }

  const idempotencyKey = autoTopupAttemptKey(input.triggerLedgerId);
  const [created] = await db.insert(schema.autoTopupAttempts).values({
    tenantId: input.tenantId,
    triggerLedgerId: input.triggerLedgerId,
    paymentMethodId: input.paymentMethodId,
    idempotencyKey,
    amountMinor: input.amountMinor,
    currency: input.currency,
    balanceAtTriggerMinor: input.balanceAtTriggerMinor,
    provider: input.provider
  }).onConflictDoNothing().returning();

  if (created) return { attempt: created, created: true } as const;

  const [sameTrigger] = await db.select().from(schema.autoTopupAttempts)
    .where(or(
      eq(schema.autoTopupAttempts.idempotencyKey, idempotencyKey),
      eq(schema.autoTopupAttempts.triggerLedgerId, input.triggerLedgerId)
    )).limit(1);

  if (sameTrigger) {
    if (
      sameTrigger.tenantId !== input.tenantId ||
      sameTrigger.amountMinor !== input.amountMinor ||
      sameTrigger.currency !== input.currency ||
      sameTrigger.paymentMethodId !== input.paymentMethodId ||
      sameTrigger.provider !== input.provider
    ) {
      throw new Error('Auto top-up idempotency key was reused with different charge details.');
    }
    return { attempt: sameTrigger, created: false, coveredByExisting: false } as const;
  }

  // The other intentional conflict is the partial unique index allowing one
  // active attempt per tenant. That existing work now covers this low-balance
  // state; historical terminal attempts do not.
  const [active] = await db.select().from(schema.autoTopupAttempts)
    .where(and(
      eq(schema.autoTopupAttempts.tenantId, input.tenantId),
      inArray(schema.autoTopupAttempts.status, [...UNSENT_STATUSES, 'dispatching', 'uncertain', 'needs_review'])
    )).limit(1);
  if (active) return { attempt: active, created: false, coveredByExisting: true } as const;

  throw new Error('Auto top-up attempt conflicted but could not be recovered.');
}

export interface AutoTopupRevalidationState {
  tenant: { postpaid: boolean; sandboxMode: boolean } | null;
  wallet: { balanceMinor: number; currency: string } | null;
  settings: {
    enabled: boolean;
    thresholdMinor: number;
    topupAmountMinor: number;
    paymentMethodId: string | null;
    consentVersion: string | null;
    consentedAt: Date | null;
    consentedByEmail: string | null;
  } | null;
  card: {
    id: string;
    tenantId: string;
    provider: string;
    reusable: boolean;
    tokenEnc: string | null;
  } | null;
}

export type AutoTopupCancellationReason =
  | 'configuration_missing'
  | 'auto_topup_disabled'
  | 'sandbox_workspace'
  | 'postpaid_workspace'
  | 'configuration_changed'
  | 'consent_missing_or_outdated'
  | 'above_provider_maximum'
  | 'wallet_currency_changed'
  | 'balance_recovered'
  | 'payment_method_missing'
  | 'payment_method_changed'
  | 'payment_method_not_reusable'
  | 'provider_changed'
  | 'unsupported_currency';

/** Pure policy function, kept separate so every cancellation rule is testable. */
export function autoTopupCancellationReason(
  attempt: Pick<Attempt, 'tenantId' | 'paymentMethodId' | 'amountMinor' | 'currency' | 'provider'>,
  state: AutoTopupRevalidationState
): AutoTopupCancellationReason | null {
  if (!state.settings) return 'configuration_missing';
  if (!state.settings.enabled) return 'auto_topup_disabled';
  if (state.settings.consentVersion !== AUTO_TOPUP_CONSENT_VERSION ||
      !state.settings.consentedAt || !state.settings.consentedByEmail) {
    return 'consent_missing_or_outdated';
  }
  if (!state.tenant) return 'configuration_missing';
  if (state.tenant.sandboxMode) return 'sandbox_workspace';
  if (state.tenant.postpaid) return 'postpaid_workspace';
  if (
    !Number.isInteger(state.settings.thresholdMinor) || state.settings.thresholdMinor < 0 ||
    !Number.isInteger(state.settings.topupAmountMinor) ||
    state.settings.topupAmountMinor <= state.settings.thresholdMinor
  ) return 'configuration_changed';
  if (
    state.settings.topupAmountMinor !== attempt.amountMinor ||
    state.settings.paymentMethodId !== attempt.paymentMethodId
  ) return 'configuration_changed';
  if (attempt.provider === 'stripe' && attempt.amountMinor > STRIPE_MAX_AMOUNT_MINOR) {
    return 'above_provider_maximum';
  }
  if (!state.wallet || state.wallet.currency !== attempt.currency) return 'wallet_currency_changed';
  if (state.wallet.balanceMinor >= state.settings.thresholdMinor) return 'balance_recovered';
  if (!state.card) return 'payment_method_missing';
  if (state.card.id !== attempt.paymentMethodId || state.card.tenantId !== attempt.tenantId) {
    return 'payment_method_changed';
  }
  if (!state.card.reusable || !state.card.tokenEnc) return 'payment_method_not_reusable';
  if (state.card.provider !== attempt.provider) return 'provider_changed';
  if (!providerSupportsWalletCurrency(state.card.provider, state.wallet.currency)) return 'unsupported_currency';
  return null;
}

// Legacy states remain readable while old preparation workers are drained.
export const UNSENT_STATUSES = ['pending', 'processing', 'ready'] as const;
export const RELEASE_CLAIM = { claimToken: null, claimedAt: null, leaseExpiresAt: null };
export const RETRY_DELAY_MS = 300_000;
export const LEASE_MS = 120_000;

export function dueUnsentAutoTopups(now = new Date()) {
  return and(inArray(schema.autoTopupAttempts.status, [...UNSENT_STATUSES]),
    or(isNull(schema.autoTopupAttempts.nextAttemptAt), lte(schema.autoTopupAttempts.nextAttemptAt, now)),
    or(isNull(schema.autoTopupAttempts.leaseExpiresAt), lte(schema.autoTopupAttempts.leaseExpiresAt, now)));
}

/** Caller holds the wallet lock. Dispatch evidence must survive cancellation. */
export async function cancelUnsentAutoTopups(
  tx: DbTransaction, tenantId: string, reason: string, attemptId?: string
) {
  const now = new Date();
  await tx.update(schema.autoTopupAttempts).set({ ...RELEASE_CLAIM,
    status: 'cancelled', retryable: false, cancellationReason: reason,
    cancelledAt: now, updatedAt: now, nextAttemptAt: null
  }).where(and(eq(schema.autoTopupAttempts.tenantId, tenantId),
    attemptId ? eq(schema.autoTopupAttempts.id, attemptId) : undefined,
    inArray(schema.autoTopupAttempts.status, [...UNSENT_STATUSES]),
    eq(schema.autoTopupAttempts.attempts, 0), isNull(schema.autoTopupAttempts.dispatchedAt),
    isNull(schema.autoTopupAttempts.lastAttemptAt), isNull(schema.autoTopupAttempts.providerReference),
    notExists(tx.select({ id: schema.payments.id }).from(schema.payments).where(and(
      eq(schema.payments.reference, schema.autoTopupAttempts.idempotencyKey),
      or(ne(schema.payments.status, 'pending'), isNotNull(schema.payments.creditedAt)))))));
}
