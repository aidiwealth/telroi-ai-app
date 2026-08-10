// GET /api/voice/otp -> verification calls for this workspace.
//
// Their own view rather than the call log: at a few million a month they would
// bury the conversations somebody actually needs to review. What a client wants
// here is different too — not who said what, but whether the code arrived,
// whether it was used, and what it cost.
import { and, eq, gte, desc, inArray, sql } from 'drizzle-orm';
import { pageParams } from '~/server/utils/paginate';
import { requireTenant } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';

export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  const q = getQuery(event);
  const days = Math.max(1, Math.min(Number(q.days) || 30, 90));
  // limit is now pageParams business; q still carries the days window.
  const since = new Date(Date.now() - days * 24 * 3600 * 1000);
  const db = useDb();

  const p = pageParams(event);
  const [{ total }] = await db.select({ total: sql<number>`count(*)` })
    .from(schema.voiceOtps)
    .where(and(eq(schema.voiceOtps.tenantId, s.tenantId), gte(schema.voiceOtps.createdAt, since)));

  const rows = await db.select({
    id: schema.voiceOtps.id,
    to: schema.voiceOtps.toNumber,
    status: schema.voiceOtps.status,
    codeLength: schema.voiceOtps.codeLength,
    attempts: schema.voiceOtps.attempts,
    maxAttempts: schema.voiceOtps.maxAttempts,
    createdAt: schema.voiceOtps.createdAt,
    verifiedAt: schema.voiceOtps.verifiedAt,
    clientSupplied: schema.voiceOtps.clientSupplied,
    expiresAt: schema.voiceOtps.expiresAt,
    reason: schema.voiceOtps.reason
  }).from(schema.voiceOtps)
    .where(and(eq(schema.voiceOtps.tenantId, s.tenantId), gte(schema.voiceOtps.createdAt, since)))
    .orderBy(desc(schema.voiceOtps.createdAt))
    .limit(p.limit).offset(p.offset);

  // What each one cost, from the ledger rather than recomputed — the rate can
  // change, and a client reconciling an invoice wants what was actually charged.
  const costs = new Map<string, number>();
  if (rows.length) {
    const refs = rows.map((r) => `otp_${r.id}`);
    const led = await db.select({ reference: schema.ledger.reference, amount: schema.ledger.amountMinor })
      .from(schema.ledger)
      .where(and(eq(schema.ledger.tenantId, s.tenantId), inArray(schema.ledger.reference, refs)));
    for (const l of led) costs.set(String(l.reference).replace(/^otp_/, ''), Number(l.amount) || 0);
  }

  const items = rows.map((r) => ({
    ...r,
    chargedMinor: costs.get(r.id) ?? null,
    // A client-supplied code can never read as verified here — we never checked
    // it. Marked so the log shows a different mode rather than a failure.
    verified: r.status === 'verified',
    clientSupplied: !!r.clientSupplied
  }));

  const summary = {
    total: items.length,
    delivered: items.filter((i) => i.status === 'delivered' || i.status === 'verified').length,
    verified: items.filter((i) => i.verified).length,
    failed: items.filter((i) => i.status === 'failed').length,
    chargedMinor: items.reduce((n, i) => n + (i.chargedMinor || 0), 0)
  };

  // The existing shape kept, with paging alongside it: wrapping in paged()
  // would nest items inside items and break every caller for no gain.
  return {
    object: 'list', summary, items,
    total: Number(total), page: p.page, perPage: p.perPage,
    pages: Math.max(1, Math.ceil(Number(total) / p.perPage))
  };
});
