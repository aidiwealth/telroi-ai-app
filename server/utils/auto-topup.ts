import { eq } from 'drizzle-orm';
import { useDb, schema, type Database, type DbTransaction } from '../db';
import { getOrCreateWallet } from './wallet';
import { AUTO_TOPUP_CONSENT_TEXT, AUTO_TOPUP_CONSENT_VERSION,
  cancelUnsentAutoTopups, providerSupportsWalletCurrency } from './auto-topup-attempts';
import { apiError } from './api';
import { STRIPE_MAX_AMOUNT_MINOR } from './payments';

const MAX_DATABASE_INTEGER = 2_147_483_647;

export type AutoTopupIneligibleReason =
  | 'sandbox_workspace'
  | 'postpaid_workspace'
  | 'no_saved_card'
  | 'card_not_reusable'
  | 'unsupported_provider'
  | 'card_currency_mismatch';

export interface AutoTopupAmounts {
  thresholdMinor: number;
  topupAmountMinor: number;
}

/** Validate the customer's configuration, in integer cents or kobo. */
export function validateAutoTopupAmounts(
  amounts: AutoTopupAmounts,
  minimumTopupMinor: number,
  maximumTopupMinor = MAX_DATABASE_INTEGER
): { code: string; message: string } | null {
  if (amounts.thresholdMinor <= 0 || amounts.thresholdMinor > 2_147_483_647 || !Number.isInteger(amounts.thresholdMinor)) {
    return { code: 'invalid_threshold', message: 'The threshold must be greater than zero and use whole cents or kobo.' };
  }
  if (!Number.isSafeInteger(amounts.topupAmountMinor) || amounts.topupAmountMinor <= 0 || amounts.topupAmountMinor > 2_147_483_647) {
    return { code: 'invalid_refill', message: 'The refill amount must be a positive whole number within the supported range.' };
  }
  if (amounts.topupAmountMinor < minimumTopupMinor) {
    return { code: 'below_minimum', message: 'The refill amount is below the minimum wallet top-up.' };
  }
  if (amounts.topupAmountMinor > maximumTopupMinor) {
    return { code: 'above_provider_maximum', message: 'The refill amount exceeds the payment provider limit.' };
  }
  // If an empty wallet is refilled to an amount still below its threshold, a
  // polling worker could charge it repeatedly. Requiring the refill to clear
  // the threshold makes one trigger converge to a safe state.
  if (amounts.topupAmountMinor <= amounts.thresholdMinor) {
    return { code: 'refill_below_threshold', message: 'The refill amount must be greater than the threshold.' };
  }
  return null;
}

/** Load everything needed to display or safely act on auto top-up state. */
export async function getAutoTopupState(tenantId: string, db: Database | DbTransaction = useDb(), lockedWallet?: typeof schema.wallets.$inferSelect) {
  const [wallet, tenantRows, settingsRows, cardRows, pricing] = await Promise.all([
    lockedWallet ?? getOrCreateWallet(tenantId),
    db.select({
      postpaid: schema.tenants.postpaid,
      sandboxMode: schema.tenants.sandboxMode
    }).from(schema.tenants).where(eq(schema.tenants.id, tenantId)).limit(1),
    db.select().from(schema.autoTopupSettings)
      .where(eq(schema.autoTopupSettings.tenantId, tenantId)).limit(1),
    db.select().from(schema.paymentMethods)
      .where(eq(schema.paymentMethods.tenantId, tenantId)).limit(1),
    db.select().from(schema.pricing).where(eq(schema.pricing.id, 'singleton')).limit(1)
  ]);

  const tenant = tenantRows[0];
  const settings = settingsRows[0] || null;
  const card = cardRows[0] || null;
  const minimumTopupMinor = wallet.currency === 'NGN'
    ? (pricing[0]?.minTopupNgnMinor ?? 1500000)
    : (pricing[0]?.minTopupUsdMinor ?? 1000);
  const maximumTopupMinor = wallet.currency === 'USD'
    ? STRIPE_MAX_AMOUNT_MINOR
    : MAX_DATABASE_INTEGER;

  let ineligibleReason: AutoTopupIneligibleReason | null = null;
  if (tenant?.sandboxMode) ineligibleReason = 'sandbox_workspace';
  else if (tenant?.postpaid) ineligibleReason = 'postpaid_workspace';
  else if (!card) ineligibleReason = 'no_saved_card';
  else if (!card.reusable || !card.tokenEnc) ineligibleReason = 'card_not_reusable';
  else if (card.provider !== 'stripe' && card.provider !== 'paystack') ineligibleReason = 'unsupported_provider';
  else if (!providerSupportsWalletCurrency(card.provider, wallet.currency)) ineligibleReason = 'card_currency_mismatch';

  return { wallet, tenant, settings, card, minimumTopupMinor, maximumTopupMinor, ineligibleReason };
}

export interface AutoTopupConsentActor {
  userId: string;
  email: string;
}

/** Compare and update settings under the wallet lock, so concurrent saves and
 * dispatches observe one committed configuration. No provider calls occur here. */
export async function saveAutoTopupSettings(
  tenantId: string,
  values: AutoTopupAmounts & { enabled: boolean; consentAccepted?: boolean },
  actor: AutoTopupConsentActor,
  db = useDb()
) {
  return db.transaction(async tx => {
    const [wallet] = await tx.select().from(schema.wallets)
      .where(eq(schema.wallets.tenantId, tenantId)).for('update').limit(1);
    if (!wallet) throw apiError('no_wallet', 'No wallet for this workspace', 404);
    const before = await getAutoTopupState(tenantId, tx, wallet);
    const error = validateAutoTopupAmounts(values, before.minimumTopupMinor, before.maximumTopupMinor);
    if (error) throw apiError(error.code, error.message);
    if (values.enabled && before.ineligibleReason) {
      throw apiError(before.ineligibleReason, 'This workspace needs a verified, compatible saved card and prepaid live billing to enable auto top-up.', 409);
    }
    const now = new Date();
    const paymentMethodId = before.card?.id ?? null;
    const changed = before.settings && (before.settings.thresholdMinor !== values.thresholdMinor ||
      before.settings.topupAmountMinor !== values.topupAmountMinor || before.settings.paymentMethodId !== paymentMethodId);
    const consentIsCurrent = before.settings?.consentVersion === AUTO_TOPUP_CONSENT_VERSION &&
      !!before.settings.consentedAt && !!before.settings.consentedByEmail;
    const needsConsent = values.enabled && (!before.settings?.enabled || !!changed || !consentIsCurrent);
    if (needsConsent && values.consentAccepted !== true) {
      throw apiError('auto_topup_consent_required', 'Accept the current auto top-up terms before enabling this configuration.', 409);
    }
    if (needsConsent && (!actor.userId || !actor.email.trim())) {
      throw apiError('auto_topup_consent_actor_missing', 'The workspace owner accepting auto top-up could not be identified.', 409);
    }
    const consent = needsConsent ? {
      consentVersion: AUTO_TOPUP_CONSENT_VERSION,
      consentedAt: now,
      consentedByUserId: actor.userId,
      consentedByEmail: actor.email
    } : {
      consentVersion: before.settings?.consentVersion ?? null,
      consentedAt: before.settings?.consentedAt ?? null,
      consentedByUserId: before.settings?.consentedByUserId ?? null,
      consentedByEmail: before.settings?.consentedByEmail ?? null
    };
    const payload = { enabled: values.enabled, thresholdMinor: values.thresholdMinor,
      topupAmountMinor: values.topupAmountMinor, paymentMethodId, ...consent, updatedAt: now };
    await tx.insert(schema.autoTopupSettings).values({ tenantId, ...payload })
      .onConflictDoUpdate({ target: schema.autoTopupSettings.tenantId, set: payload });
    if (!values.enabled || changed) {
      await cancelUnsentAutoTopups(tx, tenantId, values.enabled ? 'configuration_changed' : 'auto_topup_disabled');
    }
    return wallet.currency;
  });
}

/** Strip encrypted/provider-only card fields from the API response. */
export function autoTopupResponse(state: Awaited<ReturnType<typeof getAutoTopupState>>) {
  const { wallet, settings, card, minimumTopupMinor, maximumTopupMinor, ineligibleReason } = state;
  return {
    configured: !!settings,
    enabled: !!settings?.enabled,
    thresholdMinor: settings?.thresholdMinor ?? null,
    topupAmountMinor: settings?.topupAmountMinor ?? null,
    currency: wallet.currency,
    minimumTopupMinor,
    maximumTopupMinor,
    consent: {
      requiredVersion: AUTO_TOPUP_CONSENT_VERSION,
      text: AUTO_TOPUP_CONSENT_TEXT,
      acceptedVersion: settings?.consentVersion ?? null,
      acceptedAt: settings?.consentedAt ?? null
    },
    eligible: ineligibleReason === null,
    ineligibleReason,
    paymentMethod: card ? {
      id: card.id,
      provider: card.provider,
      brand: card.brand,
      last4: card.last4,
      expMonth: card.expMonth,
      expYear: card.expYear,
      reusable: card.reusable
    } : null
  };
}
