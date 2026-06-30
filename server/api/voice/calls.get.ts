// GET /api/voice/calls -> Telroi history/json with filters + pagination.
// Merges in Telroi-owned ratings/notes (keyed by call uid) so the UI shows the
// user's persisted rating, not just whatever the PBX returned.
import { inArray, and, eq, gte, desc } from 'drizzle-orm';
import { requireTenant } from '~/server/utils/api';
import { telroiFor } from '~/server/utils/tenant';
import { useDb, schema } from '~/server/db';

export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  const q = getQuery(event);
  const client = await telroiFor(s.tenantId);
  const calls = await client.historyJson({
    period: q.period, type: q.type, limit: q.limit ?? 100,
    user: q.user, client: q.client, diversion: q.diversion,
    start: q.start, end: q.end, processMissed: true
  });

  // Overlay our stored ratings/notes for these calls.
  const uids = (calls || []).map((c: any) => c.uid).filter(Boolean);
  const db = useDb();
  if (uids.length) {
    const rows = await db.select().from(schema.callRatings)
      .where(and(eq(schema.callRatings.tenantId, s.tenantId), inArray(schema.callRatings.callUid, uids)));
    const byUid = new Map(rows.map((r) => [r.callUid, r]));
    for (const c of calls as any[]) {
      const r = byUid.get(c.uid);
      if (r) {
        if (r.rating != null) c.rating = r.rating;
        if (r.note != null) c.note = r.note;
      }
    }
  }

  // Merge locally-recorded attempts (every placed/failed attempt, including
  // non-PBX carrier calls and sandbox calls) that the PBX history won't include,
  // so the log shows EVERY attempt. We add any local event not already present
  // in the PBX history (matched by uid).
  try {
    const since = new Date(Date.now() - 35 * 24 * 3600 * 1000); // ~last 35 days
    const local = await db.select().from(schema.callEvents)
      .where(and(eq(schema.callEvents.tenantId, s.tenantId), gte(schema.callEvents.startedAt, since)))
      .orderBy(desc(schema.callEvents.startedAt)).limit(500);
    const pbxUids = new Set(uids);
    const localCalls = local
      // Keep any local attempt the PBX history doesn't already show.
      .filter((e) => !pbxUids.has(e.callid))
      .map((e) => ({
        uid: e.callid,
        // The column is `direction` ('in'|'out'); there is no `type` column, so
        // reading e.type defaulted every local call to 'out'. Use direction.
        type: e.direction || 'out',
        status: e.status === 'failed' ? 'Failed' : (e.status === 'placed' ? 'Placed' : (e.status || 'placed')),
        // Show caller/dialed number; for inbound with no caller-id, fall back to
        // the DID dialed (raw.did).
        client: e.phone || (e.raw as any)?.did || '—',
        destination: (e.raw as any)?.did || (e.direction === 'out' ? e.phone : undefined) || undefined,
        diversion: (e.raw as any)?.did || undefined,
        user: e.user || undefined,
        start: (e.startedAt || e.createdAt)?.toISOString?.() || String(e.startedAt || e.createdAt),
        wait: 0, duration: e.duration || 0,
        failed: e.status === 'failed',
        reason: (e.raw as any)?.reason || undefined,
        local: true
      }));
    const merged = [...localCalls, ...(calls as any[])]
      .sort((a, b) => new Date(b.start).getTime() - new Date(a.start).getTime());
    return { calls: merged };
  } catch {
    return { calls };
  }
});
