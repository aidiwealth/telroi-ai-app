// server/utils/billing.ts
// Reusable recurring-billing engine. Charges every active number subscription
// whose nextBillingAt has passed: DID fee + channels * channel fee, debited from
// the tenant's wallet. Idempotent per cycle (the ledger reference includes the
// billing date), and suspends a subscription rather than overdrawing a wallet
// that can't pay. Shared by the cron endpoint (/api/cron/billing) and the CLI
// runner (server/db/run-billing.ts) so the logic lives in exactly one place.
import { and, eq, lte, sql } from 'drizzle-orm';
import { schema, useDb } from '../db';
import { canSpend, debitInTransaction } from '~/server/utils/wallet';

function isInsufficientFunds(error: any): boolean {
  return error?.data?.error?.code === 'insufficient_funds'
    || error?.cause?.data?.error?.code === 'insufficient_funds';
}

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

  // Per-tenant rate overrides, loaded once and layered per subscription below.
  // This read only the global row, so a client on a negotiated DID or channel
  // rate was charged it by numbers/purchase (which goes through getPricing with
  // a tenant id) and then the global rate on every monthly renewal after.
  const overrideRows = await db.select().from(schema.pricingOverrides);
  const overrides = new Map<string, any>(overrideRows.map((o: any) => [o.tenantId, o]));

  const due = await db.select().from(schema.numberSubscriptions)
    .where(and(eq(schema.numberSubscriptions.status, 'active'), lte(schema.numberSubscriptions.nextBillingAt, now)));
  result.due = due.length;

  for (const sub of due) {
    const [wallet] = await db.select().from(schema.wallets).where(eq(schema.wallets.tenantId, sub.tenantId)).limit(1);
    if (!wallet) { result.skipped++; result.details.push({ telnum: sub.telnum, outcome: 'skipped' }); continue; }

    const conv = (usdMinor: number) => wallet.currency === 'USD' ? usdMinor : Math.round(usdMinor * ngn);
    // Per-number DID price can be overridden on the inventory row; fall back to global.
    const ov = overrides.get(sub.tenantId);
    const didMinor = conv(ov?.didMonthlyUsdMinor ?? didUsd);
    const amount = didMinor + conv(ov?.channelMonthlyUsdMinor ?? chUsd) * (sub.channels || 1);
    const cycleRef = `numbill_${sub.id}_${now.toISOString().slice(0, 10)}`;

    // Idempotency: already billed this cycle?
    const [dupe] = await db.select().from(schema.ledger)
      .where(and(eq(schema.ledger.reference, cycleRef), eq(schema.ledger.kind, 'debit'))).limit(1);
    if (dupe) { result.skipped++; result.details.push({ telnum: sub.telnum, outcome: 'skipped' }); continue; }

    // A postpaid client shouldn't lose their numbers over a subscription fee
    // while their calls run on credit — everything lands on the same invoice.
    const [t] = await db.select({
      postpaid: schema.tenants.postpaid,
      creditLimitMinor: schema.tenants.creditLimitMinor,
      billingSuspendedAt: schema.tenants.billingSuspendedAt
    }).from(schema.tenants).where(eq(schema.tenants.id, sub.tenantId)).limit(1);
    if (!canSpend(t, wallet.balanceMinor, amount)) {
      // A postpaid client at their ceiling has the charge deferred, not their
      // number taken. Suspension is heavy — a number can be reassigned, and
      // somebody who settles their invoice would expect it back rather than
      // discovering they had lost it. For them, losing service is a consequence
      // of an unpaid invoice, which arrives with warning; hitting the limit is
      // just a full month.
      if (t?.postpaid) {
        result.details.push({ telnum: sub.telnum, outcome: 'skipped' });
        result.skipped++;
        continue;
      }
      // Auto top-up is the only unattended saved-card charge path. An
      // unaffordable renewal is suspended without submitting a second charge.
      await db.update(schema.numberSubscriptions).set({ status: 'suspended' })
        .where(eq(schema.numberSubscriptions.id, sub.id));
      result.suspended++;
      result.details.push({ telnum: sub.telnum, outcome: 'suspended' });
      continue;
    }

    const nextDate = new Date(sub.nextBillingAt); nextDate.setDate(nextDate.getDate() + 30);
    try {
      const debited = await db.transaction(async (tx: any) => {
        const movement = await debitInTransaction(tx, {
          tenantId: sub.tenantId,
          amountMinor: amount,
          reason: 'number_monthly',
          reference: cycleRef,
          meta: { telnum: sub.telnum, channels: sub.channels }
        });
        await tx.update(schema.numberSubscriptions).set({ lastBilledAt: now, nextBillingAt: nextDate })
          .where(eq(schema.numberSubscriptions.id, sub.id));
        return movement;
      });
      if (debited.idempotent) {
        result.skipped++;
        result.details.push({ telnum: sub.telnum, outcome: 'skipped' });
      } else {
        result.charged++;
        result.details.push({ telnum: sub.telnum, outcome: 'charged', amountMinor: amount, currency: wallet.currency });
      }
    } catch (error: any) {
      // The earlier balance read is only an optimization. debitInTransaction
      // owns the authoritative wallet lock, so another concurrent debit can
      // still make this unaffordable before we get it.
      if (!isInsufficientFunds(error)) throw error;
      await db.update(schema.numberSubscriptions).set({ status: 'suspended' })
        .where(eq(schema.numberSubscriptions.id, sub.id));
      result.suspended++;
      result.details.push({ telnum: sub.telnum, outcome: 'suspended' });
    }
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
    // Annual clients pay once and are not billed again for a year, so both the
    // price and the step forward depend on the interval. Getting one right and
    // the other wrong would charge a year's fee every thirty days.
    const interval = (t.billingInterval === 'annual' ? 'annual' : 'monthly') as 'monthly' | 'annual';
    // Per seat, not per workspace. A plan gives every member their own sign-in,
    // their own extension and their own place in the ring group, so the cost of
    // serving a team scales with the team — and charging a five-person
    // workspace what a one-person workspace pays meant the larger customer was
    // the cheaper one to be.
    //
    // Counted at renewal rather than held on the tenant, so a seat removed
    // between cycles simply is not there: the count is a fact about the
    // workspace now, not a number somebody has to remember to decrement.
    const [seatRow] = await db.select({ n: sql<number>`count(*)::int` })
      .from(schema.memberships).where(eq(schema.memberships.tenantId, t.id));
    const seats = Math.max(1, seatRow?.n || 1);
    const feeUsd = planFeeUsdMinor(t.plan, pricing || {}, interval) * seats;
    const nextDate = new Date(t.planNextBillingAt as any);
    if (interval === 'annual') nextDate.setFullYear(nextDate.getFullYear() + 1);
    else nextDate.setDate(nextDate.getDate() + 30);
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
    // The count on the entry, so an invoice can say why a workspace of five
    // paid five times the list price rather than leaving them to work it out.
    const seatMeta = { seats, perSeatUsdMinor: Math.round(feeUsd / seats) };
    const [dupe] = await db.select().from(schema.ledger)
      .where(and(eq(schema.ledger.reference, cycleRef), eq(schema.ledger.kind, 'debit'))).limit(1);
    if (dupe) { result.plans.skipped++; continue; }
    const [pt] = await db.select({
      postpaid: schema.tenants.postpaid,
      creditLimitMinor: schema.tenants.creditLimitMinor,
      billingSuspendedAt: schema.tenants.billingSuspendedAt
    }).from(schema.tenants).where(eq(schema.tenants.id, t.id)).limit(1);
    if (!canSpend(pt, wallet.balanceMinor, planAmount)) {
      // Leave the billing anchor in place. A later wallet credit allows the
      // next run to collect this fee without another saved-card charge path.
      result.plans.unpaid++;
      continue;
    }
    try {
      const debited = await db.transaction(async (tx: any) => {
        const movement = await debitInTransaction(tx, {
          tenantId: t.id,
          amountMinor: planAmount,
          reason: 'plan_fee',
          reference: cycleRef,
          meta: { plan: t.plan, interval, ...seatMeta }
        });
        await tx.update(schema.tenants).set({ planLastBilledAt: now, planNextBillingAt: nextDate })
          .where(eq(schema.tenants.id, t.id));
        return movement;
      });
      if (debited.idempotent) result.plans.skipped++;
      else result.plans.charged++;
    } catch (error: any) {
      if (!isInsufficientFunds(error)) throw error;
      result.plans.unpaid++;
    }
  }

  return result;
}

/**
 * Charge for a seat added partway through a cycle.
 *
 * Seats are counted at renewal, so without this a workspace could add ten
 * people the day after billing and have them free until the next one. The seat
 * works from the moment it exists, so it is paid for from then too.
 *
 * Prorated rather than charged in full: a member added with four days left in
 * the cycle costs four days. Charging a whole month for four days is the thing
 * customers write in about, and the arithmetic to avoid it is one division.
 *
 * Never refuses. A workspace that cannot cover a few dollars still gets its
 * colleague — the shortfall sits on the wallet like any other spend, and
 * turning away a customer who is growing is a poor trade for a small sum.
 */
export async function seatCostMinor(tenantId: string): Promise<{ amountMinor: number; daysLeft: number } | null> {
  const db = useDb();
  const now = new Date();
  const [t] = await db.select().from(schema.tenants).where(eq(schema.tenants.id, tenantId)).limit(1);
  if (!t || t.isInternal) return null;
  if (t.trialEndsAt && new Date(t.trialEndsAt) > now) return null;
  if (!t.planNextBillingAt) return null;

  const { getPricing, planFeeUsdMinor } = await import('./pricing');
  const pricing = await getPricing(tenantId);
  const interval = (t.billingInterval === 'annual' ? 'annual' : 'monthly') as 'monthly' | 'annual';
  const seatUsd = planFeeUsdMinor(t.plan, pricing || {}, interval);
  if (!seatUsd) return null;

  const cycleDays = interval === 'annual' ? 365 : 30;
  const msLeft = new Date(t.planNextBillingAt as any).getTime() - now.getTime();
  const daysLeft = Math.max(0, Math.min(cycleDays, Math.ceil(msLeft / 86400000)));
  if (daysLeft <= 0) return null;

  const [wallet] = await db.select().from(schema.wallets).where(eq(schema.wallets.tenantId, tenantId)).limit(1);
  if (!wallet) return null;
  const usdMinor = Math.round((seatUsd * daysLeft) / cycleDays);
  const amountMinor = wallet.currency === 'USD'
    ? usdMinor
    : Math.round(usdMinor * ((pricing as any)?.ngnPerUsd || 1600));
  return { amountMinor, daysLeft };
}

/** Can this workspace afford one more seat right now? Asked before the member
 *  is created rather than after: a seat that could not be charged would be a
 *  seat used free until the next renewal, and refusing at the point of adding
 *  is clearer to the customer than a debt appearing later. */
export async function canAffordSeat(tenantId: string): Promise<boolean> {
  const cost = await seatCostMinor(tenantId);
  if (!cost || cost.amountMinor < 1) return true;
  const { canSpend } = await import('./wallet');
  const db = useDb();
  const [wallet] = await db.select().from(schema.wallets).where(eq(schema.wallets.tenantId, tenantId)).limit(1);
  if (!wallet) return true;
  const [t] = await db.select({
    postpaid: schema.tenants.postpaid,
    creditLimitMinor: schema.tenants.creditLimitMinor,
    billingSuspendedAt: schema.tenants.billingSuspendedAt
  }).from(schema.tenants).where(eq(schema.tenants.id, tenantId)).limit(1);
  return canSpend(t, wallet.balanceMinor, cost.amountMinor);
}

export async function prorateSeat(tenantId: string, userId: string): Promise<{ charged: number } | null> {
  const db = useDb();
  const now = new Date();

  const [t] = await db.select().from(schema.tenants).where(eq(schema.tenants.id, tenantId)).limit(1);
  if (!t || t.isInternal) return null;
  // A trial covers the fee, so it covers the seats inside it.
  if (t.trialEndsAt && new Date(t.trialEndsAt) > now) return null;
  if (!t.planNextBillingAt) return null;

  const { getPricing } = await import('./pricing');
  const { planFeeUsdMinor } = await import('./pricing');
  const pricing = await getPricing(tenantId);
  const interval = (t.billingInterval === 'annual' ? 'annual' : 'monthly') as 'monthly' | 'annual';
  const seatUsd = planFeeUsdMinor(t.plan, pricing || {}, interval);
  if (!seatUsd) return null;

  const cycleDays = interval === 'annual' ? 365 : 30;
  const msLeft = new Date(t.planNextBillingAt as any).getTime() - now.getTime();
  const daysLeft = Math.max(0, Math.min(cycleDays, Math.ceil(msLeft / 86400000)));
  if (daysLeft <= 0) return null;

  const [wallet] = await db.select().from(schema.wallets).where(eq(schema.wallets.tenantId, tenantId)).limit(1);
  if (!wallet) return null;
  const usdMinor = Math.round((seatUsd * daysLeft) / cycleDays);
  const amountMinor = wallet.currency === 'USD'
    ? usdMinor
    : Math.round(usdMinor * ((pricing as any)?.ngnPerUsd || 1600));
  if (amountMinor < 1) return null;

  // Keyed on the member, so a retry or a re-invite cannot charge twice for the
  // same seat in the same cycle.
  const reference = `seat_${tenantId}_${userId}_${String(t.planNextBillingAt).slice(0, 10)}`;
  const { debit } = await import('./wallet');
  await debit({
    tenantId, amountMinor, reason: 'plan_seat', reference,
    meta: { userId, daysLeft, cycleDays, seatUsdMinor: seatUsd, interval, prorated: true }
  });
  return { charged: amountMinor };
}
