// GET /api/wallet/ledger?page= -> this workspace's money movements.
//
// Paged rather than capped at a hundred: a busy month passes that in a week,
// and a list that silently stops is worse than one that says how much there is.
import { eq, desc, sql } from 'drizzle-orm';
import { requireTenant } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
import { pageParams, paged } from '~/server/utils/paginate';

export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  const db = useDb();
  const p = pageParams(event);

  const [{ total }] = await db.select({ total: sql<number>`count(*)` })
    .from(schema.ledger).where(eq(schema.ledger.tenantId, s.tenantId));

  const rows = await db.select().from(schema.ledger)
    .where(eq(schema.ledger.tenantId, s.tenantId))
    .orderBy(desc(schema.ledger.createdAt))
    .limit(p.limit).offset(p.offset);

  return paged(rows.map((r) => ({
    id: r.id, kind: r.kind, amountMinor: r.amountMinor, balanceAfterMinor: r.balanceAfterMinor,
    reason: r.reason, reference: r.reference, sandbox: !!r.sandbox, createdAt: r.createdAt
  })), Number(total), p);
});
