// GET /api/admin/finance/virtual-accounts?page= -> every reserved account.
//
// The balance shown is the workspace's wallet, not the account: a reserved
// account is a conduit, and money reaching it credits the wallet and leaves
// nothing behind. Labelling it otherwise would have somebody looking for funds
// that were never there.
import { eq, desc, sql } from 'drizzle-orm';
import { requirePlatformAdmin } from '~/server/utils/platform';
import { useDb, schema } from '~/server/db';
import { pageParams, paged } from '~/server/utils/paginate';

export default defineEventHandler(async (event) => {
  await requirePlatformAdmin(event);
  const db = useDb();
  const p = pageParams(event, 25);

  const [{ total }] = await db.select({ total: sql<number>`count(*)` }).from(schema.virtualAccounts);

  const rows = await db.select({
    id: schema.virtualAccounts.id,
    provider: schema.virtualAccounts.provider,
    bankName: schema.virtualAccounts.bankName,
    accountNumber: schema.virtualAccounts.accountNumber,
    accountName: schema.virtualAccounts.accountName,
    createdAt: schema.virtualAccounts.createdAt,
    workspace: schema.tenants.name,
    slug: schema.tenants.slug,
    balanceMinor: schema.wallets.balanceMinor,
    currency: schema.wallets.currency
  }).from(schema.virtualAccounts)
    .leftJoin(schema.tenants, eq(schema.tenants.id, schema.virtualAccounts.tenantId))
    .leftJoin(schema.wallets, eq(schema.wallets.tenantId, schema.virtualAccounts.tenantId))
    .orderBy(desc(schema.virtualAccounts.createdAt))
    .limit(p.limit).offset(p.offset);

  return paged(rows, Number(total), p);
});
