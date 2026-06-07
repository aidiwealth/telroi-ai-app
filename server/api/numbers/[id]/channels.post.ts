// POST /api/numbers/[id]/channels  { channels }
// Adjust the channel count on a number subscription.
//   - INCREASE: charge a prorated top-up for the added channels covering the
//     remaining days of the current cycle, immediately, from the wallet. The
//     billing anchor (nextBillingAt) is unchanged, so the next full cycle bills
//     the new count. This is the fair, industry-standard proration model.
//   - DECREASE: applied immediately for enforcement, but no refund; the lower
//     fee simply takes effect from the next cycle.
// Sandbox records a simulated ledger entry instead of a real debit.
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { requireTenant, apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
import { getPricing, toCurrencyMinor } from '~/server/utils/pricing';
import { getOrCreateWallet, debit, canAfford, sandboxLedgerEntry } from '~/server/utils/wallet';
import { isSandbox } from '~/server/utils/sandbox';

const Body = z.object({ channels: z.number().int().min(1).max(50) });

export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  const id = getRouterParam(event, 'id');
  const p = Body.safeParse(await readBody(event));
  if (!id || !p.success) throw apiError('invalid', 'A channel count (1–50) is required');
  const db = useDb();

  const [sub] = await db.select().from(schema.numberSubscriptions)
    .where(and(eq(schema.numberSubscriptions.id, id), eq(schema.numberSubscriptions.tenantId, s.tenantId))).limit(1);
  if (!sub) throw apiError('not_found', 'Number not found', 404);

  const current = sub.channels || 1;
  const next = p.data.channels;
  if (next === current) return { channels: current, charged: 0, note: 'No change' };

  // Decrease: apply now, no charge, no refund. New (lower) fee bills next cycle.
  if (next < current) {
    await db.update(schema.numberSubscriptions).set({ channels: next }).where(eq(schema.numberSubscriptions.id, sub.id));
    return { channels: next, charged: 0, note: 'Channels reduced. The lower monthly fee applies from your next billing date.' };
  }

  // Increase: prorate the added channels over the remaining days of this cycle.
  const wallet = await getOrCreateWallet(s.tenantId);
  const pricing = await getPricing(s.tenantId);
  const perChannelMonthMinor = toCurrencyMinor(pricing.channelMonthlyUsdMinor, wallet.currency as any, pricing.ngnPerUsd);
  const added = next - current;

  // Days left in the current 30-day cycle (cap to [1,30]).
  const msLeft = new Date(sub.nextBillingAt).getTime() - Date.now();
  const daysLeft = Math.max(1, Math.min(30, Math.ceil(msLeft / 86400000)));
  const proratedMinor = Math.round(perChannelMonthMinor * added * (daysLeft / 30));
  const reference = `chadj_${sub.id}_${Date.now()}`;
  const meta = { telnum: sub.telnum, from: current, to: next, added, daysLeft, perChannelMonthMinor };

  if (await isSandbox(s.tenantId)) {
    await db.update(schema.numberSubscriptions).set({ channels: next }).where(eq(schema.numberSubscriptions.id, sub.id));
    await sandboxLedgerEntry({ tenantId: s.tenantId, amountMinor: proratedMinor, reason: 'channel_adjust', reference: `sbx_${reference}`, meta });
    return { channels: next, charged: 0, simulated: proratedMinor, currency: wallet.currency, sandbox: true,
      note: `Sandbox: would charge a prorated ${proratedMinor} ${wallet.currency} minor for ${added} added channel(s).` };
  }

  if (!(await canAfford(s.tenantId, proratedMinor))) {
    throw apiError('insufficient_funds', 'Not enough wallet balance for the prorated channel charge. Top up your wallet and try again.', 402);
  }

  await debit({ tenantId: s.tenantId, amountMinor: proratedMinor, reason: 'channel_adjust', reference, meta });
  await db.update(schema.numberSubscriptions).set({ channels: next }).where(eq(schema.numberSubscriptions.id, sub.id));

  return {
    channels: next,
    charged: proratedMinor,
    currency: wallet.currency,
    note: `Added ${added} channel(s). Charged a prorated amount for the ${daysLeft} day(s) left this cycle; the full amount bills from your next billing date.`
  };
});
