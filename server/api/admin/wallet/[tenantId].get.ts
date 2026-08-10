// GET /api/admin/wallet/:tenantId?page= -> wallet and ledger for a workspace.
//
// Paged: this list only grows, and a fifty-row window with no way past it means
// an operator answering "what was this client charged in March" has to go to the
// database instead.
import { eq, desc, sql } from 'drizzle-orm';
import { requirePlatformAdmin } from '~/server/utils/platform';
import { useDb, schema } from '~/server/db';
import { pageParams } from '~/server/utils/paginate';

export default defineEventHandler(async (event) => {
  await requirePlatformAdmin(event);
  const tenantId = getRouterParam(event, 'tenantId')!;
  const db = useDb();
  const p = pageParams(event, 25);

  const [wallet] = await db.select().from(schema.wallets).where(eq(schema.wallets.tenantId, tenantId)).limit(1);

  const [{ total }] = await db.select({ total: sql<number>`count(*)` })
    .from(schema.ledger).where(eq(schema.ledger.tenantId, tenantId));

  const ledger = await db.select().from(schema.ledger)
    .where(eq(schema.ledger.tenantId, tenantId))
    .orderBy(desc(schema.ledger.createdAt))
    .limit(p.limit).offset(p.offset);

  // ledger keeps its key so the page needs no change to keep working.
  return {
    wallet: wallet || null, ledger,
    total: Number(total), page: p.page, perPage: p.perPage,
    pages: Math.max(1, Math.ceil(Number(total) / p.perPage))
  };
});
