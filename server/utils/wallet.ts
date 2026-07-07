// server/utils/wallet.ts
// Money-safe wallet operations. All amounts are INTEGER minor units (kobo/cents).
//
// Guarantees:
//  - debit() is atomic and hard-stops at zero (never overdraws)
//  - every movement writes an immutable ledger row with balance-after
//  - credit() is idempotent by reference (a webhook retrying won't double-credit)
import { eq, and } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { useDb, schema } from '../db';
import { apiError } from './api';

// Records the currency + the USD<->NGN rate in effect at transaction time, so
// the admin accounting view can convert any entry to USD using the rate that
// applied when it happened. USD entries carry rate 1.
async function fxStamp(currency: string): Promise<{ currency: string; ngnPerUsd: number }> {
  if (currency !== 'NGN') return { currency, ngnPerUsd: 1 };
  try {
    const db = useDb();
    const [p] = await db.select({ r: schema.pricing.ngnPerUsd }).from(schema.pricing).where(eq(schema.pricing.id, 'singleton')).limit(1);
    return { currency, ngnPerUsd: p?.r ?? 1600 };
  } catch { return { currency, ngnPerUsd: 1600 }; }
}

export async function getOrCreateWallet(tenantId: string, currency?: 'NGN' | 'USD') {
  const db = useDb();
  const [existing] = await db.select().from(schema.wallets).where(eq(schema.wallets.tenantId, tenantId)).limit(1);
  if (existing) return existing;
  // Guard: the tenant must exist before we create its wallet. If it doesn't
  // (e.g. a session cookie left over from a DB reset that points at a tenant
  // which no longer exists), fail cleanly with a 401 so the client re-auths,
  // instead of surfacing a raw foreign-key violation.
  const [tenant] = await db.select({ id: schema.tenants.id, country: schema.tenants.country })
    .from(schema.tenants).where(eq(schema.tenants.id, tenantId)).limit(1);
  if (!tenant) throw apiError('session_invalid', 'Your session is no longer valid. Please sign in again.', 401);
  // Currency follows the client's country (e.g. Nigeria -> NGN) unless a caller
  // explicitly passes one. This is what makes a Nigerian workspace get a Naira
  // wallet (and therefore bank-transfer funding) instead of the USD default.
  let resolved: 'NGN' | 'USD' = currency || 'USD';
  if (!currency) {
    const { currencyForCountry } = await import('./countries');
    resolved = currencyForCountry(tenant.country);
  }
  const [created] = await db.insert(schema.wallets).values({ tenantId, currency: resolved }).returning();
  return created;
}

export interface DebitArgs {
  tenantId: string;
  amountMinor: number;     // positive integer
  reason: string;          // 'voice_minute' | 'plan_fee' | feature key
  reference?: string;      // idempotency / correlation
  meta?: Record<string, unknown>;
}

/** Atomically debit a wallet. Hard stop at zero — throws 402 if insufficient. */
export async function debit(args: DebitArgs) {
  if (!Number.isInteger(args.amountMinor) || args.amountMinor <= 0) {
    throw apiError('invalid_amount', 'Debit amount must be a positive integer (minor units)');
  }
  const db = useDb();

  return await db.transaction(async (tx) => {
    // Lock the wallet row for the duration of the transaction.
    const [wallet] = await tx.select().from(schema.wallets)
      .where(eq(schema.wallets.tenantId, args.tenantId)).for('update').limit(1);
    if (!wallet) throw apiError('no_wallet', 'No wallet for this workspace', 404);

    // Idempotency: if this reference already produced a debit, return it.
    if (args.reference) {
      const [dupe] = await tx.select().from(schema.ledger)
        .where(and(eq(schema.ledger.reference, args.reference), eq(schema.ledger.kind, 'debit'))).limit(1);
      if (dupe) return { balanceMinor: wallet.balanceMinor, ledgerId: dupe.id, idempotent: true };
    }

    // Hard stop at zero — no overdraft.
    if (wallet.balanceMinor < args.amountMinor) {
      throw apiError('insufficient_funds', 'Wallet balance is too low for this feature. Please top up.', 402);
    }

    const after = wallet.balanceMinor - args.amountMinor;
    await tx.update(schema.wallets).set({ balanceMinor: after, updatedAt: new Date() }).where(eq(schema.wallets.id, wallet.id));
    // Stamp the currency and the FX rate in effect now, so the accounting team
    // can convert this entry to USD later using the HISTORICAL rate (not today's).
    const fxMeta = await fxStamp(wallet.currency);
    const [row] = await tx.insert(schema.ledger).values({
      walletId: wallet.id, tenantId: args.tenantId, kind: 'debit',
      amountMinor: args.amountMinor, balanceAfterMinor: after,
      reason: args.reason, reference: args.reference, meta: { ...fxMeta, ...(args.meta ?? {}) }
    }).returning();

    return { balanceMinor: after, ledgerId: row.id, idempotent: false };
  });
}

/** Credit a wallet (top-up). Idempotent by reference — webhook-safe. */
export async function credit(tenantId: string, amountMinor: number, reason: string, reference: string, meta: Record<string, unknown> = {}) {
  if (!Number.isInteger(amountMinor) || amountMinor <= 0) {
    throw apiError('invalid_amount', 'Credit amount must be a positive integer (minor units)');
  }
  const db = useDb();
  return await db.transaction(async (tx) => {
    const [wallet] = await tx.select().from(schema.wallets)
      .where(eq(schema.wallets.tenantId, tenantId)).for('update').limit(1);
    if (!wallet) throw apiError('no_wallet', 'No wallet for this workspace', 404);

    // Idempotency: a webhook retry with the same reference must not double-credit.
    const [dupe] = await tx.select().from(schema.ledger)
      .where(and(eq(schema.ledger.reference, reference), eq(schema.ledger.kind, 'credit'))).limit(1);
    if (dupe) return { balanceMinor: wallet.balanceMinor, idempotent: true };

    const after = wallet.balanceMinor + amountMinor;
    await tx.update(schema.wallets).set({ balanceMinor: after, updatedAt: new Date() }).where(eq(schema.wallets.id, wallet.id));
    const fxMeta = await fxStamp(wallet.currency);
    await tx.insert(schema.ledger).values({
      walletId: wallet.id, tenantId, kind: 'credit',
      amountMinor, balanceAfterMinor: after, reason, reference, meta: { ...fxMeta, ...meta }
    });
    return { balanceMinor: after, idempotent: false };
  }).then(async (r) => {
    // A real top-up/credit counts as account activity (suppresses follow-ups).
    if (!(r as any).idempotent) {
      try { const { touchActivity } = await import('./activity'); await touchActivity(tenantId); } catch { /* */ }
    }
    return r;
  });
}

/** Check affordability without debiting (for gating a feature before use). */
/** Charge the monthly DID fee when a number is first provisioned on a vendor.
 *  Billing begins ONLY at provision time (local numbers are free). Idempotent
 *  per number+month so re-provisioning won't double-charge. */
export async function chargeNumberProvision(tenantId: string, telnum: string) {
  const db = useDb();
  const wallet = await getOrCreateWallet(tenantId);
  const [p] = await db.select().from(schema.pricing).where(eq(schema.pricing.id, 'singleton')).limit(1);
  const usdMinor = p?.didMonthlyUsdMinor ?? 170;
  // Convert to wallet currency.
  let amountMinor = usdMinor;
  if (wallet.currency === 'NGN') {
    const rate = Number(p?.ngnPerUsd) || 1600;
    amountMinor = Math.round((usdMinor / 100) * rate * 100); // USD->NGN minor units
  }
  const month = new Date().toISOString().slice(0, 7); // YYYY-MM
  const reference = `did_${telnum}_${month}`;
  // Sandbox: record the simulated monthly charge (badged, not real) — consistent
  // with number purchase, call minutes and managed AI. Never debit a sandbox wallet.
  const { isSandbox } = await import('./sandbox');
  if (await isSandbox(tenantId)) {
    await sandboxLedgerEntry({ tenantId, amountMinor, reason: 'number_provision', reference: `sbx_${reference}`, meta: { telnum, kind: 'did_monthly' } });
    return { ok: true, sandbox: true };
  }
  try {
    await debit({ tenantId, amountMinor, reason: 'number_provision', reference, meta: { telnum, kind: 'did_monthly' } });
    return { ok: true };
  } catch (e: any) {
    // Insufficient funds etc. — surface but don't crash provisioning caller.
    return { ok: false, reason: e?.data?.error?.code || e?.message };
  }
}

/** Record a SANDBOX transaction in the ledger for visibility, WITHOUT moving any
 *  real money. amountMinor is the simulated cost (what it would charge live);
 *  balanceAfterMinor mirrors the current real balance (unchanged). Tagged
 *  sandbox:true so finance views can badge + filter it and never count it in
 *  real totals. Visible to both client and admin. */
export async function sandboxLedgerEntry(opts: {
  tenantId: string; amountMinor: number; reason: string; reference?: string; meta?: Record<string, unknown>;
}) {
  const db = useDb();
  try {
    const wallet = await getOrCreateWallet(opts.tenantId);
    const [row] = await db.insert(schema.ledger).values({
      walletId: wallet.id, tenantId: opts.tenantId, kind: 'debit',
      amountMinor: opts.amountMinor, balanceAfterMinor: wallet.balanceMinor, // balance UNCHANGED
      reason: opts.reason, reference: opts.reference || null,
      meta: { ...(opts.meta || {}), simulated: true },
      sandbox: true
    }).returning();
    return { ok: true, ledgerId: row.id };
  } catch (e: any) {
    return { ok: false, reason: e?.message };
  }
}

export async function canAfford(tenantId: string, amountMinor: number): Promise<boolean> {  const db = useDb();
  const [w] = await db.select().from(schema.wallets).where(eq(schema.wallets.tenantId, tenantId)).limit(1);
  return !!w && w.balanceMinor >= amountMinor;
}

/**
 * Charge the tenant's saved card-on-file and credit the proceeds to their
 * wallet. Provider-agnostic: dispatches to the stored provider. The actual
 * provider API call is isolated in chargeViaProvider — wire real Stripe/Paystack
 * server-side charge calls there. Records a payment row + log for a full audit
 * trail. Returns { ok, credited, reference } or throws apiError on failure.
 *
 * NOTE: This performs a real money movement once provider keys are wired. With
 * no provider configured it returns { ok:false, reason:'provider_unconfigured' }
 * so callers can degrade gracefully (e.g. skip the onboarding auto-charge).
 */
export async function chargeCardToWallet(opts: {
  tenantId: string; amountMinor: number; currency: 'NGN' | 'USD'; reason: string;
}): Promise<{ ok: boolean; reference?: string; reason?: string }> {
  const db = useDb();
  const { eq } = await import('drizzle-orm');
  const { logEvent } = await import('./logs');

  const [pm] = await db.select().from(schema.paymentMethods)
    .where(eq(schema.paymentMethods.tenantId, opts.tenantId)).limit(1);
  if (!pm) return { ok: false, reason: 'no_card_on_file' };

  const reference = `chg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  let providerResult: { ok: boolean; reason?: string };
  try {
    providerResult = await chargeViaProvider(pm.provider, pm.token, opts.amountMinor, opts.currency, reference);
  } catch (e: any) {
    await logEvent({ tenantId: opts.tenantId, kind: 'system', action: 'card.charge_failed', level: 'error', summary: `${opts.reason}: ${e?.message || 'charge error'}`, ref: reference });
    return { ok: false, reason: 'charge_error' };
  }

  if (!providerResult.ok) {
    await logEvent({ tenantId: opts.tenantId, kind: 'system', action: 'card.charge_failed', level: 'warn', summary: `${opts.reason}: ${providerResult.reason}`, ref: reference });
    return { ok: false, reason: providerResult.reason };
  }

  // Record the payment and credit the wallet (idempotent on reference).
  await db.insert(schema.payments).values({
    tenantId: opts.tenantId, provider: pm.provider, reference,
    amountMinor: opts.amountMinor, currency: opts.currency, status: 'succeeded', creditedAt: new Date()
  }).onConflictDoNothing();
  await credit(opts.tenantId, opts.amountMinor, opts.reason, reference, { source: 'card_on_file' });
  await logEvent({ tenantId: opts.tenantId, kind: 'system', action: 'card.charged', summary: `${opts.reason} — ${opts.currency} ${(opts.amountMinor / 100).toFixed(2)}`, ref: reference });
  return { ok: true, reference };
}

// Isolated provider charge. Wire real server-side charge calls here when keys
// are configured. Until then, returns provider_unconfigured so callers degrade.
async function chargeViaProvider(provider: string, _token: string, _amountMinor: number, _currency: string, _reference: string): Promise<{ ok: boolean; reason?: string }> {
  const cfg = useRuntimeConfig() as any;
  if (provider === 'stripe' && cfg.stripeSecretKey) {
    // TODO: call Stripe PaymentIntents with the saved payment_method + off_session.
    return { ok: false, reason: 'provider_unconfigured' };
  }
  if (provider === 'paystack' && cfg.paystackSecretKey) {
    // TODO: call Paystack /transaction/charge_authorization with the auth token.
    return { ok: false, reason: 'provider_unconfigured' };
  }
  return { ok: false, reason: 'provider_unconfigured' };
}
