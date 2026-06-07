// GET /api/admin/finance -> platform-wide financial log from the ledger:
// every float paid in (credits) and every debit, with a feature category and
// the workspace it belongs to. Query: ?kind=credit|debit ?category=... ?limit=
import { desc, eq, and } from 'drizzle-orm';
import { requirePlatformAdmin } from '~/server/utils/platform';
import { useDb, schema } from '~/server/db';

function categoryFor(reason: string): { category: string; label: string } {
  const map: Record<string, { category: string; label: string }> = {
    topup: { category: 'float', label: 'Wallet top-up' },
    manual_topup: { category: 'float', label: 'Manual float (admin)' },
    number_purchase: { category: 'numbers', label: 'Number purchase' },
    number_purchase_topup: { category: 'float', label: 'Top-up for number' },
    number_monthly: { category: 'numbers', label: 'Number monthly fee' },
    voice_minute: { category: 'voice', label: 'Voice — call minutes' },
    plan_fee: { category: 'plan', label: 'Plan subscription' },
    channel_monthly: { category: 'voice', label: 'Voice channel monthly' }
  };
  return map[reason] || { category: 'other', label: reason.replace(/_/g, ' ') };
}

export default defineEventHandler(async (event) => {
  await requirePlatformAdmin(event);
  const q = getQuery(event);
  const db = useDb();

  const limit = Math.min(Number(q.limit) || 200, 500);
  const conds: any[] = [];
  if (q.kind === 'credit' || q.kind === 'debit') conds.push(eq(schema.ledger.kind, q.kind as string));

  const rows = await db.select().from(schema.ledger)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(schema.ledger.createdAt))
    .limit(limit);

  const tenants = await db.select({ id: schema.tenants.id, name: schema.tenants.name, isInternal: schema.tenants.isInternal }).from(schema.tenants);
  const nameById = new Map(tenants.map((t) => [t.id, t]));

  // Current rate as a fallback for any historical entry written before FX
  // stamping existed.
  const [pricing] = await db.select({ r: schema.pricing.ngnPerUsd }).from(schema.pricing).where(eq(schema.pricing.id, 'singleton')).limit(1);
  const currentRate = pricing?.r ?? 1600;

  let entries = rows.map((r) => {
    const cat = categoryFor(r.reason);
    const t = nameById.get(r.tenantId);
    const m = (r.meta as any) || {};
    const currency: 'NGN' | 'USD' = m.currency === 'NGN' ? 'NGN' : 'USD';
    const rate = currency === 'NGN' ? (Number(m.ngnPerUsd) || currentRate) : 1;
    // USD-normalized amount (minor units). For NGN entries, divide by the rate.
    const usdMinor = currency === 'NGN' ? Math.round(r.amountMinor / rate) : r.amountMinor;
    return {
      id: r.id, createdAt: r.createdAt, kind: r.kind,
      amountMinor: r.amountMinor,            // native minor units
      nativeCurrency: currency,
      fxRate: rate,                          // ngn per usd at txn time (1 for USD)
      usdMinor,                              // normalized to USD minor units
      balanceAfterMinor: r.balanceAfterMinor,
      reason: r.reason, category: cat.category, label: cat.label,
      reference: r.reference,
      sandbox: !!r.sandbox,
      workspace: t?.name || '—', internal: !!t?.isInternal
    };
  });
  if (q.category) entries = entries.filter((e) => e.category === q.category);
  // Sandbox filter: by default show everything (badged); ?sandbox=exclude hides them,
  // ?sandbox=only shows just sandbox entries.
  if (q.sandbox === 'exclude') entries = entries.filter((e) => !e.sandbox);
  else if (q.sandbox === 'only') entries = entries.filter((e) => e.sandbox);

  // Totals are kept in USD (the accounting baseline) plus native breakdowns.
  // SANDBOX entries are NEVER counted in real totals — they're simulated.
  const totals = { creditUsdMinor: 0, debitUsdMinor: 0, byCategoryUsdMinor: {} as Record<string, number> };
  for (const e of entries) {
    if (e.sandbox) continue;
    if (e.kind === 'credit') totals.creditUsdMinor += e.usdMinor;
    else totals.debitUsdMinor += e.usdMinor;
    totals.byCategoryUsdMinor[e.category] = (totals.byCategoryUsdMinor[e.category] || 0) + e.usdMinor;
  }

  return { entries, totals, currentRate };
});
