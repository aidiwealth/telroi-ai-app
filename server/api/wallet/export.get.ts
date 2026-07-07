// GET /api/wallet/export -> streamed CSV of the client's own wallet ledger,
// hard-capped to the last 30 days (server-enforced) and streamed in batches so
// a large ledger never loads entirely into memory. Uses the shared streamCsv
// primitive that the admin finance + calls exports use.
import { desc, eq, and, gte } from 'drizzle-orm';
import { requireTenant } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
import { streamCsv, exportSince } from '~/server/utils/csv-export';

export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  const db = useDb();
  const since = exportSince();

  // Wallet currency for the header labels.
  const [wallet] = await db.select({ currency: schema.wallets.currency })
    .from(schema.wallets).where(eq(schema.wallets.tenantId, s.tenantId)).limit(1);
  const cur = wallet?.currency || 'USD';

  return streamCsv(
    event,
    `transactions-${new Date().toISOString().slice(0, 10)}.csv`,
    ['Date', 'Description', 'Type', `Amount (${cur})`, `Balance after (${cur})`, 'Sandbox', 'Reference'],
    (r) => {
      const amt = (r.kind === 'credit' ? '' : '-') + (Math.abs(r.amountMinor || 0) / 100).toFixed(2);
      return [
        r.createdAt?.toISOString?.() || r.createdAt,
        r.reason || '',
        r.kind || '',
        amt,
        ((r.balanceAfterMinor || 0) / 100).toFixed(2),
        r.sandbox ? 'yes' : 'no',
        r.reference || ''
      ];
    },
    async (offset, limit) => {
      return await db.select().from(schema.ledger)
        .where(and(eq(schema.ledger.tenantId, s.tenantId), gte(schema.ledger.createdAt, since)))
        .orderBy(desc(schema.ledger.createdAt))
        .limit(limit).offset(offset);
    }
  );
});
