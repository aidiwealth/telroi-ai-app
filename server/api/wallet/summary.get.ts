// GET /api/wallet/summary?month=YYYY-MM -> money-in / money-out for a month
// plus a 3-month trailing average. Computed from the immutable ledger.
import { eq, and, gte, lt } from 'drizzle-orm';
import { requireTenant } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';

export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  const monthStr = (getQuery(event).month as string) || new Date().toISOString().slice(0, 7);
  const [y, m] = monthStr.split('-').map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1));
  const end = new Date(Date.UTC(y, m, 1));
  const threeAgo = new Date(Date.UTC(y, m - 4, 1));

  const db = useDb();
  const rows = await db.select().from(schema.ledger)
    .where(and(eq(schema.ledger.tenantId, s.tenantId), gte(schema.ledger.createdAt, threeAgo), lt(schema.ledger.createdAt, end)));

  let moneyIn = 0, moneyOut = 0, in3 = 0, out3 = 0;
  for (const r of rows) {
    const inMonth = r.createdAt >= start && r.createdAt < end;
    if (r.kind === 'credit') { if (inMonth) moneyIn += r.amountMinor; in3 += r.amountMinor; }
    else { if (inMonth) moneyOut += r.amountMinor; out3 += r.amountMinor; }
  }
  return {
    month: monthStr,
    moneyInMinor: moneyIn, moneyOutMinor: moneyOut,
    avgInMinor: Math.round(in3 / 3), avgOutMinor: Math.round(out3 / 3)
  };
});
