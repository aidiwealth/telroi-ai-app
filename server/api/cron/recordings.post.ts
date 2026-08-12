// POST /api/cron/recordings -> delete what has passed its retention.
//
// Storage is cheap but not free, and a promise to keep a recording for seven
// days is also a promise not to keep it for seven hundred. A client who was told
// thirty days should find it gone on the thirty-first.
import { and, eq, lt, sql } from 'drizzle-orm';
import { useDb, schema } from '~/server/db';
import { deleteObject } from '~/server/utils/storage';

export default defineEventHandler(async (event) => {
  const cfg = useRuntimeConfig() as any;
  const secret = (cfg.cronSecret as string) || '';
  if (!secret || getHeader(event, 'x-cron-secret') !== secret) {
    throw createError({ statusCode: 401, statusMessage: 'unauthorized' });
  }

  const db = useDb();
  // Bounded per run: a backlog should drain over a few runs rather than hold a
  // request open while it deletes thousands of objects.
  const due = await db.select().from(schema.callRecordings)
    .where(and(eq(schema.callRecordings.status, 'stored'), lt(schema.callRecordings.expiresAt, new Date())))
    .limit(200);

  let removed = 0, failed = 0;
  for (const r of due) {
    try {
      if (r.objectKey) await deleteObject(r.objectKey);
      // The row stays, marked expired: a client asking why a recording is gone
      // deserves better than silence, and the row is bytes where the audio was
      // megabytes.
      await db.update(schema.callRecordings)
        .set({ status: 'expired', objectKey: null, transcript: null })
        .where(eq(schema.callRecordings.id, r.id));
      removed++;
    } catch { failed++; }
  }

  return { ok: true, considered: due.length, removed, failed };
});
