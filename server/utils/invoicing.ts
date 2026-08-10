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
  // The day is read in the client's own timezone. A Lagos client asking to be
  // invoiced on the 9th means the 9th where they are — running on UTC would land
  // their invoice on the 10th for the first hour of every day, and on the 8th for
  // clients west of us.

  const tenants = await db.select().from(schema.tenants).where(eq(schema.tenants.postpaid, true));

  for (const t of tenants as any[]) {
    const localDay = Number(new Intl.DateTimeFormat('en-GB', {
      timeZone: t.timezone || 'UTC', day: 'numeric'
    }).format(now));
    if (!t.billingDay || t.billingDay !== localDay) continue;
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

    // What they owe, not what they spent. A client who held funds at the start of
    // the period has already paid for part of it — invoicing the full spend would
    // charge them twice for the same calls. The deficit is the honest figure, and
    // paying it brings the wallet back to zero.
    const [w] = await db.select().from(schema.wallets).where(eq(schema.wallets.tenantId, t.id)).limit(1);
    const owed = Math.max(0, -(w?.balanceMinor ?? 0));
    const spent = Number(total || 0);
    const amount = Math.min(owed, spent);
    if (amount <= 0) {
      result.skipped++;
      result.details.push({ tenant: t.name, outcome: 'nothing-owed' });
      continue;
    }

    const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(schema.invoices);
    const number = invoiceNumber(Number(count) + 1, now);

    const termsDays = t.paymentTermsDays ?? 7;
    const dueAt = new Date(now.getTime() + termsDays * 86400000);

    const [created] = await db.insert(schema.invoices).values({
      tenantId: t.id, number, periodStart, periodEnd,
      amountMinor: amount, currency, dueAt
    }).returning();

    result.issued++;
    result.details.push({ tenant: t.name, outcome: 'issued', amountMinor: amount, number });

    // Told, not left to be discovered. Best-effort: an email that fails should
    // not undo an invoice that is correctly raised.
    void notifyInvoice(t, { id: created?.id, number, amountMinor: amount, currency, dueAt, periodStart, periodEnd }, 'issued')
      .catch((e) => console.error('[invoicing] issue email failed:', e?.message));
  }

  return result;
}


/** Who to write to, and the details they need to pay. */
async function notifyInvoice(tenant: any, inv: any, kind: 'issued' | 'reminder' | 'suspended', daysLeft = 0): Promise<void> {
  const db = useDb();
  const [owner] = await db.select({ email: schema.users.email })
    .from(schema.memberships)
    .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
    .where(and(eq(schema.memberships.tenantId, tenant.id), eq(schema.memberships.role, 'owner')))
    .limit(1);
  if (!owner?.email) return;

  let bank: any = null;
  try {
    const [acct] = await db.select().from(schema.virtualAccounts)
      .where(eq(schema.virtualAccounts.tenantId, tenant.id)).limit(1);
    if (acct?.accountNumber) bank = { bankName: acct.bankName, accountNumber: acct.accountNumber, accountName: acct.accountName };
  } catch { /* the invoice stands without transfer details */ }

  const sym = inv.currency === 'USD' ? '$' : '₦';
  const amount = sym + (inv.amountMinor / 100).toLocaleString('en-US', { minimumFractionDigits: 2 });
  const fmt = (d: Date) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  const mail = await import('~/server/utils/email');

  if (kind === 'issued') {
    await mail.sendInvoiceIssuedEmail(owner.email, {
      workspace: tenant.name, number: inv.number, amount,
      dueDate: fmt(inv.dueAt), periodLabel: `${fmt(inv.periodStart)} to ${fmt(inv.periodEnd)}`,
      invoiceId: inv.id, bank
    });
  } else if (kind === 'reminder') {
    await mail.sendInvoiceReminderEmail(owner.email, {
      workspace: tenant.name, number: inv.number, amount,
      dueDate: fmt(inv.dueAt), daysLeft, invoiceId: inv.id, bank
    });
  } else {
    await mail.sendBillingSuspendedEmail(owner.email, {
      workspace: tenant.name, number: inv.number, amount, invoiceId: inv.id, bank
    });
  }
}

export interface DunningResult { reminded: number; suspended: number; }

/** Chase what is owed, then stop service — in that order, and never the second
 *  without the first. Somebody who loses calling should have seen it coming
 *  twice. */
export async function runDunning(now = new Date()): Promise<DunningResult> {
  const db = useDb();
  const out: DunningResult = { reminded: 0, suspended: 0 };

  const open = await db.select().from(schema.invoices).where(eq(schema.invoices.status, 'open'));

  for (const inv of open) {
    const [t] = await db.select().from(schema.tenants).where(eq(schema.tenants.id, inv.tenantId)).limit(1);
    if (!t) continue;
    const daysLeft = Math.ceil((new Date(inv.dueAt).getTime() - now.getTime()) / 86400000);

    if (daysLeft <= 0) {
      if (!(t as any).billingSuspendedAt) {
        await db.update(schema.tenants).set({ billingSuspendedAt: now }).where(eq(schema.tenants.id, t.id));
        await notifyInvoice(t, inv, 'suspended').catch((e) => console.error('[dunning] suspend email failed:', e?.message));
        out.suspended++;
      }
      continue;
    }

    // Two warnings, each sent once. remindedAt holds the last day-count used, so
    // a job running twice in a day doesn't write twice.
    if (daysLeft === 3 || daysLeft === 1) {
      const already = inv.remindedAt && Math.ceil((new Date(inv.dueAt).getTime() - new Date(inv.remindedAt).getTime()) / 86400000) === daysLeft;
      if (already) continue;
      await db.update(schema.invoices).set({ remindedAt: now }).where(eq(schema.invoices.id, inv.id));
      await notifyInvoice(t, inv, 'reminder', daysLeft).catch((e) => console.error('[dunning] reminder failed:', e?.message));
      out.reminded++;
    }
  }

  return out;
}
