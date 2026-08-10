// GET /api/invoices/:id -> one invoice with the charges behind it.
//
// The lines come from the ledger, not from a stored copy: an invoice that can
// be reconciled against the calls that produced it is worth more than one that
// merely asserts a total. Rentals are itemised because a client wants to know
// which number; volume charges collapse to a count, because 4,000 rows of
// "Voice OTP" is not a document anybody reads.
import { and, eq, gte, lt, desc } from 'drizzle-orm';
import { requireTenant, apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';

const LABELS: Record<string, string> = {
  number_monthly: 'Number rental',
  plan_monthly: 'Plan subscription',
  voice_otp: 'Voice OTP',
  voice_call: 'Voice calls',
  ai_usage: 'AI usage',
  number_purchase: 'Number purchase'
};

export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  const id = getRouterParam(event, 'id')!;
  const db = useDb();

  const [inv] = await db.select().from(schema.invoices)
    .where(and(eq(schema.invoices.id, id), eq(schema.invoices.tenantId, s.tenantId))).limit(1);
  if (!inv) throw apiError('not_found', 'Invoice not found', 404);

  const entries = await db.select().from(schema.ledger)
    .where(and(
      eq(schema.ledger.tenantId, s.tenantId),
      eq(schema.ledger.kind, 'debit'),
      eq(schema.ledger.sandbox, false),
      gte(schema.ledger.createdAt, inv.periodStart),
      lt(schema.ledger.createdAt, inv.periodEnd)
    )).orderBy(desc(schema.ledger.createdAt));

  // Rentals keep their number; everything else groups by what it was for.
  const groups = new Map<string, { description: string; qty: number; amountMinor: number }>();
  for (const e of entries) {
    const telnum = (e.meta as any)?.telnum;
    const key = e.reason === 'number_monthly' && telnum ? `number_monthly:${telnum}` : e.reason;
    const description = e.reason === 'number_monthly' && telnum
      ? `Number rental — ${telnum}`
      : (LABELS[e.reason] || e.reason.replace(/_/g, ' '));
    const g = groups.get(key) || { description, qty: 0, amountMinor: 0 };
    g.qty += 1;
    g.amountMinor += e.amountMinor;
    groups.set(key, g);
  }

  const lines = [...groups.values()].sort((a, b) => b.amountMinor - a.amountMinor);
  const usedMinor = lines.reduce((a, l) => a + l.amountMinor, 0);

  const [ws] = await db.select().from(schema.tenants).where(eq(schema.tenants.id, s.tenantId)).limit(1);
  let bank: any = null;
  try {
    const [acct] = await db.select().from(schema.virtualAccounts)
      .where(eq(schema.virtualAccounts.tenantId, s.tenantId)).limit(1);
    if (acct?.accountNumber) bank = { accountNumber: acct.accountNumber, bankName: acct.bankName, accountName: acct.accountName };
  } catch { /* transfer details are a convenience, not the invoice */ }

  return {
    invoice: {
      id: inv.id, number: inv.number, status: inv.status,
      periodStart: inv.periodStart, periodEnd: inv.periodEnd,
      issuedAt: inv.createdAt, dueAt: inv.dueAt, paidAt: inv.paidAt,
      amountMinor: inv.amountMinor, currency: inv.currency
    },
    lines,
    usedMinor,
    // What their balance covered. Without this the amount due looks arbitrary
    // beside the total of the lines above it.
    balanceAppliedMinor: Math.max(0, usedMinor - inv.amountMinor),
    workspace: { name: ws?.name || '', email: s.email },
    bank
  };
});
