// POST /api/numbers/purchase { inventoryId, channels, chargeCard? }
// Atomically claims the inventory row, charges the first month (DID + channels),
// and records the subscription.
//   - Dashboard path (chargeCard omitted/false): debit the wallet directly; if
//     funds are insufficient, return an error telling the client to load their wallet.
//   - Onboarding path (chargeCard true): if the wallet can't cover it, charge the
//     card-on-file to top the wallet up to the cost first, then debit the wallet —
//     so the money always flows card -> wallet -> spend, keeping a clean record.
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { requireTenantManager, apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
import { getOrCreateWallet, debit, canAfford, chargeCardToWallet, sandboxLedgerEntry } from '~/server/utils/wallet';
import { getPricing, toCurrencyMinor } from '~/server/utils/pricing';
import { logEvent } from '~/server/utils/logs';

// The six sensitive categories from section 2 of the Number Use Indemnity. A
// number declared for any of them cannot be provisioned until the indemnity has
// been accepted — section 1.1 says so, and a carrier asking later will want the
// acceptance rather than an assurance.
const SENSITIVE = ['authentication', 'financial', 'health', 'emergency', 'government', 'outbound'];

const Body = z.object({
  inventoryId: z.string().uuid(),
  channels: z.number().int().min(1).max(50).default(1),
  chargeCard: z.boolean().optional(),
  // What the client says the number is for, and — where that is sensitive — the
  // acceptance recorded before they got here.
  categories: z.array(z.string().max(32)).min(1).optional(),
  acceptanceId: z.string().uuid().optional()
});

export default defineEventHandler(async (event) => {
  const s = await requireTenantManager(event);
  const p = Body.safeParse(await readBody(event));
  if (!p.success) throw apiError('invalid', 'Select a number to buy');
  const db = useDb();

  // The indemnity, before anything is claimed or charged. A client who declines
  // has not been billed and no number has been taken out of stock.
  const categories = p.data.categories?.length ? p.data.categories : ['general'];
  const sensitive = categories.filter((c) => SENSITIVE.includes(c));
  if (sensitive.length) {
    if (!p.data.acceptanceId) {
      throw apiError('indemnity_required',
        'This use needs the Number Use Indemnity accepted first.', 428);
    }
    const [acc] = await db.select().from(schema.legalAcceptances)
      .where(and(
        eq(schema.legalAcceptances.id, p.data.acceptanceId),
        // Their own acceptance, not one somebody handed them the id of.
        eq(schema.legalAcceptances.tenantId, s.tenantId)
      )).limit(1);
    if (!acc) throw apiError('indemnity_required', 'That acceptance could not be found.', 428);

    // Against the version in force. An acceptance of superseded wording is a
    // record that looks valid and is not.
    const [doc] = await db.select({ isCurrent: schema.legalDocuments.isCurrent })
      .from(schema.legalDocuments).where(eq(schema.legalDocuments.id, acc.documentId)).limit(1);
    if (!doc?.isCurrent) {
      throw apiError('indemnity_stale', 'The indemnity has been updated. Please read and accept the current version.', 409);
    }

    // And covering what they are actually declaring — accepting for
    // authentication does not cover collections.
    const covered = new Set(acc.declaredCategories || []);
    const missing = sensitive.filter((c) => !covered.has(c));
    if (missing.length) {
      throw apiError('indemnity_required', 'The indemnity you accepted does not cover every use you have selected.', 428);
    }
  }

  // Verification first. A number is a real identity on a real network and a
  // standing monthly cost — selling one to an unverified account means unwinding
  // it if the documents don't hold up, and carriers hold us to who is behind
  // their numbers. The message points at what to do rather than only refusing:
  // a trial can still test on the demo number meanwhile.
  const [comp] = await db.select({ status: schema.compliance.status })
    .from(schema.compliance).where(eq(schema.compliance.tenantId, s.tenantId)).limit(1);
  if (comp?.status !== 'approved') {
    throw apiError('compliance_required',
      comp?.status === 'pending'
        ? 'Your verification is under review. You can keep testing on the demo number, and numbers open up as soon as it is approved.'
        : 'Numbers open up once your business verification is approved. You can test on the demo number meanwhile.',
      403);
  }

  // Atomically claim the inventory row: only succeeds if still 'available'.
  const [claimed] = await db.update(schema.numberInventory)
    .set({ status: 'sold', soldToTenantId: s.tenantId })
    .where(and(eq(schema.numberInventory.id, p.data.inventoryId), eq(schema.numberInventory.status, 'available')))
    .returning();
  if (!claimed) throw apiError('unavailable', 'That number is no longer available', 409);

  // Guard: a subscription for this telnum may already exist (e.g. it was bought
  // before, or seeded). The unique index on telnum would otherwise throw a raw
  // Postgres error. Roll back the claim and return a clear message instead.
  const [existingSub] = await db.select().from(schema.numberSubscriptions)
    .where(eq(schema.numberSubscriptions.telnum, claimed.telnum)).limit(1);
  if (existingSub) {
    await db.update(schema.numberInventory)
      .set({ status: 'available', soldToTenantId: null })
      .where(eq(schema.numberInventory.id, claimed.id));
    if (existingSub.tenantId === s.tenantId) {
      throw apiError('already_owned', 'You already have this number on your account.', 409);
    }
    throw apiError('unavailable', 'That number is no longer available.', 409);
  }

  // Sandbox: record the purchase without charging the wallet or provisioning at
  // a carrier, so the workspace can test the numbers flow safely.
  const { isSandbox } = await import('~/server/utils/sandbox');
  if (await isSandbox(s.tenantId)) {
    try {
      const next = new Date(); next.setDate(next.getDate() + 30);
      const [sub] = await db.insert(schema.numberSubscriptions).values({
        tenantId: s.tenantId, telnum: claimed.telnum, region: claimed.region,
        provider: claimed.provider, channels: p.data.channels, nextBillingAt: next, lastBilledAt: new Date(),
        useCategories: categories
      }).returning();
      // Record a sandbox ledger entry showing the simulated cost (what it WOULD
      // charge live) — visible to client + admin, balance untouched.
      const wallet = await getOrCreateWallet(s.tenantId);
      const pricing = await getPricing(s.tenantId);
      const didUsd = claimed.monthlyUsdMinorOverride ?? pricing.didMonthlyUsdMinor;
      const didMinor = toCurrencyMinor(didUsd, wallet.currency as any, pricing.ngnPerUsd);
      const chMinor = toCurrencyMinor(pricing.channelMonthlyUsdMinor, wallet.currency as any, pricing.ngnPerUsd) * p.data.channels;
      const simulated = didMinor + chMinor;
      await sandboxLedgerEntry({ tenantId: s.tenantId, amountMinor: simulated, reason: 'number_purchase',
        reference: `sbx_numbuy_${claimed.telnum}_${Date.now()}`, meta: { telnum: claimed.telnum, region: claimed.region, channels: p.data.channels } });
      await logEvent({ tenantId: s.tenantId, kind: 'system', action: 'number.purchased', summary: `[sandbox] Bought ${claimed.telnum}`, ref: `sbx_${claimed.telnum}` });
      const { touchActivity } = await import('~/server/utils/activity');
      await touchActivity(s.tenantId);
      return { subscription: sub, charged: 0, simulatedCharge: simulated, currency: wallet.currency, simulated: true, livemode: false };
    } catch (e) {
      await db.update(schema.numberInventory).set({ status: 'available', soldToTenantId: null }).where(eq(schema.numberInventory.id, claimed.id));
      throw e;
    }
  }

  try {
    const wallet = await getOrCreateWallet(s.tenantId);
    const pricing = await getPricing(s.tenantId);
    const didUsd = claimed.monthlyUsdMinorOverride ?? pricing.didMonthlyUsdMinor;
    const didMinor = toCurrencyMinor(didUsd, wallet.currency as any, pricing.ngnPerUsd);
    const chMinor = toCurrencyMinor(pricing.channelMonthlyUsdMinor, wallet.currency as any, pricing.ngnPerUsd) * p.data.channels;
    const total = didMinor + chMinor;

    // If the wallet can't cover it: either top up via card (onboarding opt-in)
    // or stop and ask them to load the wallet (dashboard default).
    if (!(await canAfford(s.tenantId, total))) {
      if (p.data.chargeCard) {
        // Top up the wallet from the card by the full cost, then debit below.
        const charged = await chargeCardToWallet({ tenantId: s.tenantId, amountMinor: total, currency: wallet.currency as any, reason: 'number_purchase_topup' });
        if (!charged.ok) {
          // Roll back the claim and report a clear reason.
          await db.update(schema.numberInventory).set({ status: 'available', soldToTenantId: null }).where(eq(schema.numberInventory.id, claimed.id));
          const msg = charged.reason === 'no_card_on_file' ? 'No card on file to charge.'
            : charged.reason === 'provider_unconfigured' ? 'Card charging is not enabled yet. Please load your wallet to continue.'
            : 'We could not charge your card. Please load your wallet to continue.';
          throw apiError('charge_failed', msg, 402);
        }
      } else {
        await db.update(schema.numberInventory).set({ status: 'available', soldToTenantId: null }).where(eq(schema.numberInventory.id, claimed.id));
        throw apiError('insufficient_funds', 'Your wallet balance is too low. Please load your wallet and try again.', 402);
      }
    }

    const ref = `numbuy_${claimed.telnum}_${Date.now()}`;
    await debit({ tenantId: s.tenantId, amountMinor: total, reason: 'number_purchase', reference: ref,
      meta: { telnum: claimed.telnum, region: claimed.region, channels: p.data.channels } });

    const next = new Date(); next.setDate(next.getDate() + 30);
    const [sub] = await db.insert(schema.numberSubscriptions).values({
      tenantId: s.tenantId, telnum: claimed.telnum, region: claimed.region,
      provider: claimed.provider,
      channels: p.data.channels, nextBillingAt: next, lastBilledAt: new Date(),
      useCategories: categories
    }).returning();

    // The acceptance was recorded before the number existed, so it carries the
    // inventory id and no number. Writing it back now is what lets an operator
    // search the register by number — without it, every acceptance names
    // nothing and the register cannot answer the question it exists for.
    if (p.data.acceptanceId) {
      await db.update(schema.legalAcceptances)
        .set({ telnum: claimed.telnum })
        .where(and(
          eq(schema.legalAcceptances.id, p.data.acceptanceId),
          eq(schema.legalAcceptances.tenantId, s.tenantId)
        ))
        .catch((e: any) => console.error('[purchase] could not stamp acceptance with number:', e?.message));
    }

    await logEvent({ tenantId: s.tenantId, kind: 'system', action: 'number.purchased', summary: `Bought ${claimed.telnum} (${claimed.region}, ${p.data.channels}ch)`, ref });
    return { subscription: sub, charged: total, currency: wallet.currency };
  } catch (e: any) {
    // Roll the inventory row back to available if anything after the claim failed.
    await db.update(schema.numberInventory)
      .set({ status: 'available', soldToTenantId: null })
      .where(eq(schema.numberInventory.id, claimed.id));
    throw e;
  }
  const { touchActivity } = await import('~/server/utils/activity');
  await touchActivity(s.tenantId);
});
