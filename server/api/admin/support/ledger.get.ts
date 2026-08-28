// GET /api/admin/support/ledger -> what the support workspace has been charged.
//
// Read-only, and included for the reason any ledger is: a call that cost money
// should be traceable to the call that caused it. Support calls bill like any
// other, so the record matters for the same compliance reasons.
import { eq, desc, sql } from 'drizzle-orm';
import { requirePlatformAdmin } from '~/server/utils/platform';
import { ensureSupportWorkspace } from '~/server/utils/support';
import { pageParams, paged } from '~/server/utils/paginate';
import { useDb, schema } from '~/server/db';

export default defineEventHandler(async (event) => {
  await requirePlatformAdmin(event);
  const ws = await ensureSupportWorkspace();
  const db = useDb();
  const p = pageParams(event);

  const [{ total }] = await db.select({ total: sql<number>`count(*)` })
    .from(schema.ledger).where(eq(schema.ledger.tenantId, ws.tenantId));

  const rows = await db.select().from(schema.ledger)
    .where(eq(schema.ledger.tenantId, ws.tenantId))
    .orderBy(desc(schema.ledger.createdAt))
    .limit(p.limit).offset(p.offset);

  return paged(rows.map((r) => ({
    id: r.id, kind: r.kind, amountMinor: r.amountMinor,
    balanceAfterMinor: r.balanceAfterMinor,
    reason: r.reason, reference: r.reference, sandbox: !!r.sandbox,
    createdAt: r.createdAt,
    // What made up the charge — seconds, direction, provider — so a figure
    // somebody queries has an answer.
    meta: r.meta
  })), Number(total), p);
});
