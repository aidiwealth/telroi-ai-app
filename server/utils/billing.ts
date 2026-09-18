// server/utils/billing.ts
// Reusable recurring-billing engine. Charges every active number subscription
// whose nextBillingAt has passed: DID fee + channels * channel fee, debited from
// the tenant's wallet. Idempotent per cycle (the ledger reference includes the
// billing date), and suspends a subscription rather than overdrawing a wallet
// that can't pay. Shared by the cron endpoint (/api/cron/billing) and the CLI
// runner (server/db/run-billing.ts) so the logic lives in exactly one place.
import { and, eq, lte, sql } from 'drizzle-orm';
import { schema } from '../db';
import { canSpend, chargeCardToWallet } from '~/server/utils/wallet';

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
      // Before taking their number away, try the card they left with us. A
      // client who put a card on file did so precisely so their service would
      // not stop over a wallet nobody was watching — suspending without asking
      // it first makes the card pointless.
      //
      // This only tops the wallet up. The charge below then runs exactly as it
      // would have, so the debit, the ledger entry and the next billing date
      // are written in one place rather than two.
      const shortfall = amount - wallet.balanceMinor;
      const topped = shortfall > 0
        ? await chargeCardToWallet({
            tenantId: sub.tenantId, amountMinor: shortfall,
            currency: wallet.currency as any, reason: 'number_renewal'
          }).catch(() => ({ ok: false as const }))
        : { ok: false as const };

      if (topped.ok) {
        const [fresh] = await db.select().from(schema.wallets).where(eq(schema.wallets.id, wallet.id)).limit(1);
        if (fresh && canSpend(t, fresh.balanceMinor, amount)) {
          wallet.balanceMinor = fresh.balanceMinor;
        } else {
          await db.update(schema.numberSubscriptions).set({ status: 'suspended' }).where(eq(schema.numberSubscriptions.id, sub.id));
          result.suspended++;
          result.details.push({ telnum: sub.telnum, outcome: 'suspended' });
          continue;
        }
      } else {

        await db.update(schema.numberSubscriptions).set({ status: 'suspended' }).where(eq(schema.numberSubscriptions.id, sub.id));
        result.suspended++;
        result.details.push({ telnum: sub.telnum, outcome: 'suspended' });
        continue;
      }
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
      // Ask the card before giving up. This is the recurring revenue, and a
      // client who left a card left it for exactly this.
      //
      // Only while the fee is recently due. A plan fee that cannot be paid is
      // retried every run, forever — so without a window a declining card would
      // be presented daily, which providers notice and merchants are judged on.
      // Five days is long enough for a topped-up wallet or a replaced card, and
      // short enough to stop on its own.
      const dueDays = (now.getTime() - new Date(t.planNextBillingAt as any).getTime()) / 86400000;
      let recovered = false;
      if (dueDays <= 5) {
        const shortfall = planAmount - wallet.balanceMinor;
        const topped = shortfall > 0
          ? await chargeCardToWallet({
              tenantId: t.id, amountMinor: shortfall,
              currency: wallet.currency as any, reason: 'plan_fee'
            }).catch(() => ({ ok: false as const }))
          : { ok: false as const };
        if (topped.ok) {
          const [fresh] = await db.select().from(schema.wallets).where(eq(schema.wallets.id, wallet.id)).limit(1);
          if (fresh && canSpend(pt, fresh.balanceMinor, planAmount)) {
            wallet.balanceMinor = fresh.balanceMinor;
            recovered = true;
          }
        }
      }
      if (!recovered) { result.plans.unpaid++; continue; }  // leave anchor; retry next run
    }
    const after = wallet.balanceMinor - planAmount;
    await db.transaction(async (tx: any) => {
      await tx.update(schema.wallets).set({ balanceMinor: after, updatedAt: now }).where(eq(schema.wallets.id, wallet.id));
      await tx.insert(schema.ledger).values({
        walletId: wallet.id, tenantId: t.id, kind: 'debit',
        amountMinor: planAmount, balanceAfterMinor: after, reason: 'plan_fee',
        // The seat count on the entry, so a workspace of five can be shown
        // five seats at the list price rather than an unexplained multiple.
        reference: cycleRef, meta: { plan: t.plan, interval, ...seatMeta }
      });
      await tx.update(schema.tenants).set({ planLastBilledAt: now, planNextBillingAt: nextDate }).where(eq(schema.tenants.id, t.id));
    });
    result.plans.charged++;
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
