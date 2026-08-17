// GET /api/invoices -> this workspace's invoices, and where to pay them.
//
// Paying an invoice is topping up, because the debt is the negative balance —
// so there is no separate payment flow here, only the bank details and the
// amount. The existing top-up path settles it.
import { eq, desc } from 'drizzle-orm';
import { requireTenantOwner } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';

export default defineEventHandler(async (event) => {
  const s = await requireTenantOwner(event);
  const db = useDb();

  const rows = await db.select().from(schema.invoices)
    .where(eq(schema.invoices.tenantId, s.tenantId))
    .orderBy(desc(schema.invoices.createdAt));

  // Their reserved account, where one exists. A client settling by transfer
  // should not have to ask us for the details.
  let bank: any = null;
  try {
    const [acct] = await db.select().from(schema.virtualAccounts)
      .where(eq(schema.virtualAccounts.tenantId, s.tenantId)).limit(1);
    if (acct) bank = { accountNumber: acct.accountNumber, bankName: acct.bankName, accountName: acct.accountName };
  } catch { /* no reserved account; the card and transfer options still stand */ }

  return {
    invoices: rows.map((i) => ({
      id: i.id, number: i.number,
      periodStart: i.periodStart, periodEnd: i.periodEnd,
      amountMinor: i.amountMinor, currency: i.currency,
      status: i.status, dueAt: i.dueAt, paidAt: i.paidAt, paidVia: i.paidVia
    })),
    bank
  };
});
