// POST /api/cron/stale-sessions  (header: x-cron-secret: $CRON_SECRET)
//
// Closes Live Call sessions that never ended.
//
// A session is marked 'calling' when the call is placed and closed when the
// visitor rates it or the widget reports the end. A visitor who closes the tab
// reports nothing, so their session sits at 'calling' forever — and the admin
// console, which lists exactly those, showed eleven calls in progress with not
// one of them live. Somebody could click Take over on a call from three weeks
// ago.
//
// ended_at is set to started_at rather than now: the call finished long ago,
// and dating it to this moment would make a three-week-old session look like a
// three-week-long call in every metric that reads the pair.
//
// 'abandoned' rather than 'ended', because nobody hung up — the browser simply
// stopped existing, and the difference matters to anybody reading the outcomes
// to see how the widget is performing.
import { and, inArray, isNull, lt, sql } from 'drizzle-orm';
import { useDb, schema } from '~/server/db';

export default defineEventHandler(async (event) => {
  const secret = (useRuntimeConfig() as any).cronSecret;
  const given = getHeader(event, 'x-cron-secret');
  if (secret && given !== secret) throw createError({ statusCode: 401, statusMessage: 'bad cron secret' });

  const db = useDb();
  // An hour is generous: Asterisk gives up ringing after forty seconds, and no
  // real conversation is still open an hour after it started without the
  // widget having said so.
  const cutoff = new Date(Date.now() - 3600 * 1000);

  const closed = await db.update(schema.liveCallSessions)
    .set({ status: 'ended', outcome: 'abandoned', endedAt: sql`${schema.liveCallSessions.startedAt}` })
    .where(and(
      inArray(schema.liveCallSessions.status, ['calling', 'connected']),
      isNull(schema.liveCallSessions.endedAt),
      lt(schema.liveCallSessions.startedAt, cutoff)
    )).returning({ id: schema.liveCallSessions.id });

  if (closed.length) console.log(`[cron] closed ${closed.length} abandoned live call session(s)`);
  return { ok: true, closed: closed.length };
});
