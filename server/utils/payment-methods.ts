// Verified saved-card storage. Provider tokens can initiate real charges, so
// they are encrypted at rest and never returned to a browser.
import { schema, useDb } from '../db';
import { decrypt, encrypt } from './crypto';
import { isNull, lt, or } from 'drizzle-orm';
import { z } from 'zod';

export const PAYMENT_METHOD_SAVE_CONSENT_VERSION = '2026-09-11';

export function canSavePaymentMethod(payment: {
  savePaymentMethodRequested?: boolean;
  savePaymentMethodConsentVersion?: string | null;
  savePaymentMethodConsentedAt?: Date | null;
  savePaymentMethodConsentedByEmail?: string | null;
}) {
  return payment.savePaymentMethodRequested === true
    && typeof payment.savePaymentMethodConsentVersion === 'string'
    && payment.savePaymentMethodConsentVersion.length > 0
    && payment.savePaymentMethodConsentedAt instanceof Date
    && !Number.isNaN(payment.savePaymentMethodConsentedAt.getTime())
    && typeof payment.savePaymentMethodConsentedByEmail === 'string'
    && payment.savePaymentMethodConsentedByEmail.trim().length > 0;
}

const PaystackReusableCard = z.object({
  channel: z.literal('card'),
  authorization_code: z.string().regex(/^AUTH_[A-Za-z0-9]+$/),
  reusable: z.literal(true),
  signature: z.string().min(1),
  card_type: z.string().nullable().optional(),
  brand: z.string().nullable().optional(),
  last4: z.string().regex(/^\d{4}$/).nullable().optional(),
  exp_month: z.union([z.string(), z.number()]).nullable().optional(),
  exp_year: z.union([z.string(), z.number()]).nullable().optional()
});

/** Only a verified Paystack card authorization belongs in this card-only release. */
export function paystackReusableCard(input: unknown) {
  const parsed = PaystackReusableCard.safeParse(input);
  return parsed.success ? parsed.data : null;
}

export interface VerifiedPaymentMethod {
  tenantId: string;
  provider: 'paystack' | 'stripe';
  token: string;
  sourcePaymentReference: string;
  sourcePaymentCreatedAt: Date;
  billingEmail?: string | null;
  providerCustomerId?: string | null;
  providerSignature?: string | null;
  brand?: string | null;
  last4?: string | null;
  expMonth?: number | null;
  expYear?: number | null;
}

/** Save a card recovered from a signature-verified provider webhook. */
export async function saveVerifiedPaymentMethod(input: VerifiedPaymentMethod, db = useDb()) {
  const now = new Date();
  const values = {
    provider: input.provider,
    // Never duplicate the charge-capable token in the legacy plaintext field.
    token: null,
    tokenEnc: encrypt(input.token),
    billingEmail: input.billingEmail || null,
    providerCustomerId: input.providerCustomerId || null,
    providerSignature: input.providerSignature || null,
    sourcePaymentReference: input.sourcePaymentReference,
    sourcePaymentCreatedAt: input.sourcePaymentCreatedAt,
    reusable: true,
    brand: input.brand || null,
    last4: input.last4 || null,
    expMonth: input.expMonth || null,
    expYear: input.expYear || null,
    isDefault: true,
    updatedAt: now
  };

  const [saved] = await db.insert(schema.paymentMethods).values({ tenantId: input.tenantId, ...values })
    .onConflictDoUpdate({
      target: schema.paymentMethods.tenantId,
      set: values,
      // A delayed retry for an older top-up must not replace a newer card.
      setWhere: or(
        isNull(schema.paymentMethods.sourcePaymentCreatedAt),
        lt(schema.paymentMethods.sourcePaymentCreatedAt, input.sourcePaymentCreatedAt)
      )
    })
    .returning();
  if (saved) {
    const { logEvent } = await import('./logs');
    await logEvent({
      tenantId: input.tenantId,
      kind: 'system',
      action: 'card.saved',
      summary: `Card on file: ${input.brand || 'card'} ****${input.last4 || ''}`,
      ref: input.sourcePaymentReference
    });
  }
  return saved;
}

/**
 * Read a charge-capable token. The plaintext fallback keeps existing rows
 * working during the one-release encrypted-token backfill window.
 */
export function paymentMethodToken(pm: { tokenEnc?: string | null; token?: string | null }): string | null {
  if (pm.tokenEnc) {
    try { return decrypt(pm.tokenEnc); }
    catch { return null; }
  }
  return pm.token || null;
}
