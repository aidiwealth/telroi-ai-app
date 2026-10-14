// GET /api/voice/calls -> Telroi history/json with filters + pagination.
// Merges in Telroi-owned ratings/notes (keyed by call uid) so the UI shows the
// user's persisted rating, not just whatever the PBX returned.
import { inArray, and, eq, gte, desc } from 'drizzle-orm';
import { requireTenant } from '~/server/utils/api';
import { demoIfAsked } from '~/server/utils/demo';
import { telroiFor } from '~/server/utils/tenant';
import { useDb, schema } from '~/server/db';

export default defineEventHandler(async (event) => {
    // Framed by the guided tour: sample data rather than an empty table,
  // and never a database read. See server/utils/demo.ts.
  const demo = demoIfAsked(event, 'calls'); if (demo) return demo;
  const s = await requireTenant(event);
  const q = getQuery(event);
  const client = await telroiFor(s.tenantId);
  // Sub-account view: the PBX has no sub-account concept, so for a scoped view we
  // return ONLY the call_events rows tagged to that sub-account (mapped to the
  // shape the UI expects). Parent/no-selection keeps the full PBX history below.
  const _saId = (q.sub_account_id as string) || null;
  if (_saId) {
    const { and, eq, gte, desc } = await import('drizzle-orm');
    const db2 = useDb();
    const days = q.period === 'day' ? 1 : q.period === 'week' ? 7 : q.period === 'quarter' ? 90 : 30;
    const since2 = new Date(Date.now() - days * 24 * 3600 * 1000);
    const rows2 = await db2.select().from(schema.callEvents)
      .where(and(eq(schema.callEvents.tenantId, s.tenantId), eq(schema.callEvents.subAccountId, _saId), gte(schema.callEvents.startedAt, since2)))
      .orderBy(desc(schema.callEvents.startedAt)).limit(Number(q.limit) || 500);
    const data = rows2.map((r: any) => ({
      uid: r.callid, type: r.direction === 'out' ? 'out' : 'in', direction: r.direction,
      phone: r.phone, number: r.phone, status: r.status, duration: r.duration || 0,
      wait: r.wait || 0, start: r.startedAt, user: r.user || null, carrier: r.carrier || null
    }));
    return { calls: data };
  }


  // Resolve agent sip-usernames to the person's display name so the Agent
  // column shows a name rather than "tnt_ab12cd34". `user` holds the SIP
  // username (memberships.pbx_login); join through to the user's name.
  async function resolveAgentNames(list: any[]) {
    try {
      const logins = Array.from(new Set((list || []).map((c) => c.user).filter(Boolean)));
      if (!logins.length) return;
      const rows = await useDb().select({
        pbxLogin: schema.memberships.pbxLogin,
        name: schema.users.name,
        email: schema.users.email
      }).from(schema.memberships)
        .innerJoin(schema.users, eq(schema.memberships.userId, schema.users.id))
        .where(and(eq(schema.memberships.tenantId, s.tenantId), inArray(schema.memberships.pbxLogin, logins as string[])));
      const byLogin = new Map(rows.map((r) => [r.pbxLogin, r.name || r.email || undefined]));
      for (const c of list) {
        if (c.user && byLogin.get(c.user)) c.user_name = byLogin.get(c.user);
      }
    } catch { /* name resolution is best-effort */ }
  }

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
        wait: e.wait || 0, duration: e.duration || 0,
        failed: e.status === 'failed',
        reason: (e.raw as any)?.reason || undefined,
        // The same flag rowToCall carries. Two mappers produce a call — this
        // one for local events, rowToCall for the rest — and a field added to
        // one alone is present or absent depending on which branch a row came
        // through, which reads as an intermittent fault.
        escalatedUnanswered: !!(e.raw as any)?.escalatedUnanswered,
        local: true
      }));
    // Verification calls count as calls. A workspace sending nothing but OTP was
    // showing an empty dashboard while its wallet drained — the traffic was real,
    // it just lived in another table. Marked so the call log can leave them out:
    // a few million of these would bury the conversations somebody reviews.
    let otpCalls: any[] = [];
    try {
      const otps = await db.select().from(schema.voiceOtps)
        .where(and(eq(schema.voiceOtps.tenantId, s.tenantId), gte(schema.voiceOtps.createdAt, since)))
        .orderBy(desc(schema.voiceOtps.createdAt)).limit(500);
      otpCalls = otps.map((o) => ({
        uid: `otp_${o.id}`,
        type: 'out',
        status: o.status === 'failed' ? 'Failed' : 'Delivered',
        client: o.toNumber,
        destination: o.toNumber,
        user: undefined,
        start: (o.createdAt as Date)?.toISOString?.() || String(o.createdAt),
        wait: 0,
        duration: 0,
        failed: o.status === 'failed',
        reason: o.reason || undefined,
        local: true,
        otp: true
      }));
    } catch { /* the log is still worth showing without them */ }

    // Honour the caller's limit on the merged set, not on each source.
    //
    // It was passed to the PBX history alone while local events and OTP calls
    // each fetched up to 500 of their own, so a client asking for 100 received
    // 228 — and on a busy workspace would receive a great deal more. Sliced
    // after sorting, so the newest hundred are the newest hundred overall
    // rather than whatever survived three separate caps.
    // A cursor rather than an offset. Offsets shift under you: a call arriving
    // while somebody scrolls pushes a row from page one onto page two, and they
    // see it twice or not at all. A timestamp is stable — ask for what started
    // before the oldest row you hold and the answer is the same whatever has
    // arrived since.
    const before = q.before ? new Date(String(q.before)) : null;
    const wanted = Math.min(Math.max(Number(q.limit) || 100, 1), 1000);
    const merged = [...otpCalls, ...localCalls, ...(calls as any[])]
      .sort((a, b) => new Date(b.start).getTime() - new Date(a.start).getTime())
      .filter((c: any) => !before || new Date(c.start).getTime() < before.getTime())
      .slice(0, wanted);
    await resolveAgentNames(merged);
    // Where to continue from, and null when there is nothing left — so the app
    // knows it has reached the end rather than asking again and getting the
    // same empty answer.
    const full = merged.length === wanted;
    const nextBefore = full ? merged[merged.length - 1]?.start ?? null : null;
    return { calls: merged, nextBefore };
  } catch {
    await resolveAgentNames(calls as any[]);
    return { calls };
  }
});
