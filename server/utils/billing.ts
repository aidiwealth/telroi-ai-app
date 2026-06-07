// server/utils/billing.ts
// Reusable recurring-billing engine. Charges every active number subscription
// whose nextBillingAt has passed: DID fee + channels * channel fee, debited from
// the tenant's wallet. Idempotent per cycle (the ledger reference includes the
// billing date), and suspends a subscription rather than overdrawing a wallet
// that can't pay. Shared by the cron endpoint (/api/cron/billing) and the CLI
// runner (server/db/run-billing.ts) so the logic lives in exactly one place.
import { and, eq, lte } from 'drizzle-orm';
import { schema } from '../db';

export interface BillingResult {
  due: number;
  charged: number;
  suspended: number;
  skipped: number;       // already billed this cycle (idempotent no-ops)
  details: Array<{ telnum: string; outcome: 'charged' | 'suspended' | 'skipped'; amountMinor?: number; currency?: string }>;
  plans?: { due: number; charged: number; skipped: number; unpaid: number };
}

// `db` is injected so this works with both the request-scoped Nitro db and the
// standalone script db. Pricing conversion mirrors the wallet's currency.
export async function runMonthlyBilling(db: any, opts?: { now?: Date }): Promise<BillingResult> {
  const now = opts?.now || new Date();
  const result: BillingResult = { due: 0, charged: 0, suspended: 0, skipped: 0, details: [] };

  const [pricing] = await db.select().from(schema.pricing).where(eq(schema.pricing.id, 'singleton')).limit(1);
  const didUsd = pricing?.didMonthlyUsdMinor ?? 170;
  const chUsd = pricing?.channelMonthlyUsdMinor ?? 200;
  const ngn = pricing?.ngnPerUsd ?? 1600;

  const due = await db.select().from(schema.numberSubscriptions)
    .where(and(eq(schema.numberSubscriptions.status, 'active'), lte(schema.numberSubscriptions.nextBillingAt, now)));
  result.due = due.length;

  for (const sub of due) {
    const [wallet] = await db.select().from(schema.wallets).where(eq(schema.wallets.tenantId, sub.tenantId)).limit(1);
    if (!wallet) { result.skipped++; result.details.push({ telnum: sub.telnum, outcome: 'skipped' }); continue; }

    const conv = (usdMinor: number) => wallet.currency === 'USD' ? usdMinor : Math.round(usdMinor * ngn);
    // Per-number DID price can be overridden on the inventory row; fall back to global.
    const didMinor = conv(didUsd);
    const amount = didMinor + conv(chUsd) * (sub.channels || 1);
    const cycleRef = `numbill_${sub.id}_${now.toISOString().slice(0, 10)}`;

    // Idempotency: already billed this cycle?
    const [dupe] = await db.select().from(schema.ledger)
      .where(and(eq(schema.ledger.reference, cycleRef), eq(schema.ledger.kind, 'debit'))).limit(1);
    if (dupe) { result.skipped++; result.details.push({ telnum: sub.telnum, outcome: 'skipped' }); continue; }

    if (wallet.balanceMinor < amount) {
      await db.update(schema.numberSubscriptions).set({ status: 'suspended' }).where(eq(schema.numberSubscriptions.id, sub.id));
      result.suspended++;
      result.details.push({ telnum: sub.telnum, outcome: 'suspended' });
      continue;
    }

    const after = wallet.balanceMinor - amount;
    const nextDate = new Date(sub.nextBillingAt); nextDate.setDate(nextDate.getDate() + 30);
    await db.transaction(async (tx: any) => {
      await tx.update(schema.wallets).set({ balanceMinor: after, updatedAt: now }).where(eq(schema.wallets.id, wallet.id));
      await tx.insert(schema.ledger).values({
        walletId: wallet.id, tenantId: sub.tenantId, kind: 'debit',
        amountMinor: amount, balanceAfterMinor: after, reason: 'number_monthly',
        reference: cycleRef, meta: { telnum: sub.telnum, channels: sub.channels }
      });
      await tx.update(schema.numberSubscriptions).set({ lastBilledAt: now, nextBillingAt: nextDate })
        .where(eq(schema.numberSubscriptions.id, sub.id));
    });
    result.charged++;
    result.details.push({ telnum: sub.telnum, outcome: 'charged', amountMinor: amount, currency: wallet.currency });
  }

  // ── Monthly plan fee ──────────────────────────────────────────────────────
  // Charge the workspace's plan fee (separate from per-number/channel billing)
  // for active, non-internal, non-trial tenants whose planNextBillingAt is due.
  // Custom plans (fee 0) are skipped. Unlike numbers, a plan that can't be paid
  // is NOT suspended here — we leave the anchor so it retries next run (the
  // workspace shouldn't be torn down over a plan-fee shortfall).
  result.plans = { due: 0, charged: 0, skipped: 0, unpaid: 0 };
  const { planFeeUsdMinor } = await import('./pricing');
  const planDue = await db.select().from(schema.tenants)
    .where(and(
      eq(schema.tenants.isInternal, false),
      lte(schema.tenants.planNextBillingAt, now)
    ));
  for (const t of planDue) {
    // Skip tenants currently on a trial (trial covers the fee).
    if (t.trialEndsAt && new Date(t.trialEndsAt) > now) continue;
    result.plans.due++;
    const feeUsd = planFeeUsdMinor(t.plan, pricing || {});
    const nextDate = new Date(t.planNextBillingAt as any); nextDate.setDate(nextDate.getDate() + 30);
    if (!feeUsd) {
      // Custom/zero — just advance the anchor.
      await db.update(schema.tenants).set({ planLastBilledAt: now, planNextBillingAt: nextDate }).where(eq(schema.tenants.id, t.id));
      result.plans.skipped++;
      continue;
    }
    const [wallet] = await db.select().from(schema.wallets).where(eq(schema.wallets.tenantId, t.id)).limit(1);
    if (!wallet) { result.plans.skipped++; continue; }
    const conv = (usdMinor: number) => wallet.currency === 'USD' ? usdMinor : Math.round(usdMinor * ngn);
    const planAmount = conv(feeUsd);
    const cycleRef = `planbill_${t.id}_${now.toISOString().slice(0, 10)}`;
    const [dupe] = await db.select().from(schema.ledger)
      .where(and(eq(schema.ledger.reference, cycleRef), eq(schema.ledger.kind, 'debit'))).limit(1);
    if (dupe) { result.plans.skipped++; continue; }
    if (wallet.balanceMinor < planAmount) { result.plans.unpaid++; continue; } // leave anchor; retry next run
    const after = wallet.balanceMinor - planAmount;
    await db.transaction(async (tx: any) => {
      await tx.update(schema.wallets).set({ balanceMinor: after, updatedAt: now }).where(eq(schema.wallets.id, wallet.id));
      await tx.insert(schema.ledger).values({
        walletId: wallet.id, tenantId: t.id, kind: 'debit',
        amountMinor: planAmount, balanceAfterMinor: after, reason: 'plan_fee',
        reference: cycleRef, meta: { plan: t.plan }
      });
      await tx.update(schema.tenants).set({ planLastBilledAt: now, planNextBillingAt: nextDate }).where(eq(schema.tenants.id, t.id));
    });
    result.plans.charged++;
  }

  return result;
}
