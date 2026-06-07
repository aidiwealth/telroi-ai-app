import { eq } from 'drizzle-orm';
import { requireTenant } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  const db = useDb();
  const [va] = await db.select().from(schema.virtualAccounts)
    .where(eq(schema.virtualAccounts.tenantId, s.tenantId)).limit(1);
  if (!va) return { account: null };
  return { account: {
    accountNumber: va.accountNumber, accountName: va.accountName,
    bankName: va.bankName, accounts: va.accounts, status: va.status
  } };
});
