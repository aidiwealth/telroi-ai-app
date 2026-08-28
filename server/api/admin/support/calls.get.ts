// GET /api/admin/support/calls -> the support workspace's own call list.
//
// Not /api/admin/support/sessions, which returns Live Call widget sessions —
// different data for a different screen. An operator's call log is the calls
// they and their agents actually handled.
//
// Deliberately simpler than the client's: no OTP merge and no local-events
// reconciliation, because the support workspace places no verification calls
// and every call it handles arrives through the PBX. Written rather than
// shared, since extracting the client's version would mean editing a screen in
// daily use to serve one that does not exist yet.
import { and, eq, inArray } from 'drizzle-orm';
import { requirePlatformAdmin } from '~/server/utils/platform';
import { ensureSupportWorkspace } from '~/server/utils/support';
import { telroiFor } from '~/server/utils/tenant';
import { useDb, schema } from '~/server/db';

export default defineEventHandler(async (event) => {
  await requirePlatformAdmin(event);
  const ws = await ensureSupportWorkspace();
  const q = getQuery(event);
  const client = await telroiFor(ws.tenantId);

  const calls = await client.historyJson({
    period: q.period, type: q.type, limit: q.limit ?? 100,
    start: q.start, end: q.end, processMissed: true
  });

  // Ratings and notes are ours rather than the PBX's, so they are overlaid by
  // call id — the same way the client list does it.
  try {
    const uids = calls.map((c: any) => c.uid).filter(Boolean);
    if (uids.length) {
      const rows = await useDb().select().from(schema.callRatings)
        .where(and(eq(schema.callRatings.tenantId, ws.tenantId),
                   inArray(schema.callRatings.callUid, uids as string[])));
      const byUid = new Map(rows.map((r: any) => [r.callUid, r]));
      for (const c of calls as any[]) {
        const r = byUid.get(c.uid);
        if (r) { c.rating = r.rating ?? undefined; c.note = r.note ?? undefined; }
      }
    }
  } catch { /* a missing rating is not worth failing the list for */ }

  return { calls };
});
