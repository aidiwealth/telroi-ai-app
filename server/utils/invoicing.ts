// server/utils/invoicing.ts
// Invoices for postpaid workspaces.
//
// The wallet's negative balance IS the debt, so an invoice is not a separate
// accounting record — it is a statement of what the ledger already says, and a
// due date by which it should be back at zero. That keeps one source of truth:
// every line on an invoice can be traced to the call that produced it.
import { and, eq, gte, lt, desc, sql } from 'drizzle-orm';
import { useDb, schema } from '~/server/db';

export interface InvoiceRunResult {
  considered: number;
  issued: number;
  skipped: number;
  details: Array<{ tenant: string; outcome: 'issued' | 'nothing-owed' | 'already-issued'; amountMinor?: number; number?: string }>;
}

function invoiceNumber(seq: number, when: Date): string {
  return `TLR-${when.getUTCFullYear()}${String(when.getUTCMonth() + 1).padStart(2, '0')}-${String(seq).padStart(4, '0')}`;
}

/** Issue invoices for postpaid tenants whose billing day is today.
 *
 *  Safe to run more than once a day: an invoice already covering the period is
 *  left alone rather than duplicated, because a scheduler that retries should
 *  not bill twice. */
export async function runInvoicing(now = new Date()): Promise<InvoiceRunResult> {
  const db = useDb();
  const result: InvoiceRunResult = { considered: 0, issued: 0, skipped: 0, details: [] };
  const today = now.getUTCDate();

  const tenants = await db.select().from(schema.tenants).where(eq(schema.tenants.postpaid, true));

  for (const t of tenants as any[]) {
    if (!t.billingDay || t.billingDay !== today) continue;
    result.considered++;

    // The period runs from the last invoice to now — or from the day they went
    // postpaid, for the first one. A first period is usually short, which is
    // normal and worth saying on the invoice itself.
    const [last] = await db.select().from(schema.invoices)
      .where(eq(schema.invoices.tenantId, t.id))
      .orderBy(desc(schema.invoices.periodEnd)).limit(1);
    const periodStart: Date = last?.periodEnd || t.postpaidSince || t.createdAt;
    const periodEnd = now;

    if (last && last.periodEnd >= now) {
      result.skipped++;
      result.details.push({ tenant: t.name, outcome: 'already-issued' });
      continue;
    }

    // What they actually spent in the window. Read from the ledger rather than
    // from the balance, because a top-up mid-period would otherwise erase usage
    // that genuinely happened.
    const [{ total, currency }] = await db.select({
      total: sql<number>`coalesce(sum(${schema.ledger.amountMinor}), 0)`,
      currency: sql<string>`coalesce(max(${schema.wallets.currency}), 'NGN')`
    }).from(schema.ledger)
      .leftJoin(schema.wallets, eq(schema.wallets.id, schema.ledger.walletId))
      .where(and(
        eq(schema.ledger.tenantId, t.id),
        eq(schema.ledger.kind, 'debit'),
        eq(schema.ledger.sandbox, false),
        gte(schema.ledger.createdAt, periodStart),
        lt(schema.ledger.createdAt, periodEnd)
      ));

    const amount = Number(total || 0);
    if (amount <= 0) {
      result.skipped++;
      result.details.push({ tenant: t.name, outcome: 'nothing-owed' });
      continue;
    }

    const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(schema.invoices);
    const number = invoiceNumber(Number(count) + 1, now);

    const termsDays = t.paymentTermsDays ?? 7;
    const dueAt = new Date(now.getTime() + termsDays * 86400000);

    await db.insert(schema.invoices).values({
      tenantId: t.id, number, periodStart, periodEnd,
      amountMinor: amount, currency, dueAt
    });

    result.issued++;
    result.details.push({ tenant: t.name, outcome: 'issued', amountMinor: amount, number });
  }

  return result;
}
