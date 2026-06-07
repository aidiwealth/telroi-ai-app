// GET /api/admin/finance/export[?kind=&category=] -> streamed CSV of ledger
// movements, hard-capped to the last 30 days. Streams in batches so a huge
// ledger never loads entirely into memory.
import { desc, eq, and, gte } from 'drizzle-orm';
import { requirePlatformAdmin } from '~/server/utils/platform';
import { useDb, schema } from '~/server/db';
import { streamCsv, exportSince } from '~/server/utils/csv-export';

export default defineEventHandler(async (event) => {
  await requirePlatformAdmin(event);
  const q = getQuery(event);
  const db = useDb();
  const since = exportSince();

  const conds: any[] = [gte(schema.ledger.createdAt, since)];
  if (q.kind === 'credit' || q.kind === 'debit') conds.push(eq(schema.ledger.kind, q.kind as string));

  // Resolve tenant names once.
  const tenants = await db.select({ id: schema.tenants.id, name: schema.tenants.name }).from(schema.tenants);
  const nameById = new Map(tenants.map((t) => [t.id, t.name]));

  // Current rate fallback for entries written before FX stamping.
  const [pricing] = await db.select({ r: schema.pricing.ngnPerUsd }).from(schema.pricing).where(eq(schema.pricing.id, 'singleton')).limit(1);
  const currentRate = pricing?.r ?? 1600;

  return streamCsv(
    event,
    `finance-${new Date().toISOString().slice(0, 10)}.csv`,
    ['Date', 'Workspace', 'Direction', 'Reason', 'Currency', 'Native amount', 'FX rate (NGN/USD)', 'USD amount', 'Balance after (native)', 'Reference'],
    (r) => {
      const m = (r.meta as any) || {};
      const cur = m.currency === 'NGN' ? 'NGN' : 'USD';
      const rate = cur === 'NGN' ? (Number(m.ngnPerUsd) || currentRate) : 1;
      const usdMinor = cur === 'NGN' ? Math.round(r.amountMinor / rate) : r.amountMinor;
      return [
        r.createdAt?.toISOString?.() || r.createdAt,
        nameById.get(r.tenantId) || r.tenantId,
        r.kind, r.reason,
        cur,
        (r.amountMinor / 100).toFixed(2),
        cur === 'NGN' ? String(rate) : '',
        (usdMinor / 100).toFixed(2),
        (r.balanceAfterMinor / 100).toFixed(2),
        r.reference || ''
      ];
    },
    async (offset, limit) => db.select().from(schema.ledger)
      .where(and(...conds))
      .orderBy(desc(schema.ledger.createdAt))
      .limit(limit).offset(offset)
  );
});
