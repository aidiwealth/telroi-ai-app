import { eq, desc } from 'drizzle-orm';
import { requireTenant } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  const db = useDb();
  const rows = await db.select().from(schema.ledger)
    .where(eq(schema.ledger.tenantId, s.tenantId)).orderBy(desc(schema.ledger.createdAt)).limit(100);
  return rows.map((r) => ({
    id: r.id, kind: r.kind, amountMinor: r.amountMinor, balanceAfterMinor: r.balanceAfterMinor,
    reason: r.reason, reference: r.reference, sandbox: !!r.sandbox, createdAt: r.createdAt
  }));
});
