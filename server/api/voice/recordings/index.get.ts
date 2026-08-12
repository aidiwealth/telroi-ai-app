// GET /api/voice/recordings?page= -> this workspace's recordings.
//
// Listed separately from the call log because a recording outlives the
// conversation about it and is pruned on its own schedule — and because
// somebody looking for one is looking for a recording, not a call.
import { eq, desc, sql, and, gt } from 'drizzle-orm';
import { requireTenant } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
import { pageParams, paged } from '~/server/utils/paginate';

export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  const db = useDb();
  const p = pageParams(event, 25);

  // Only what still exists. An expired row is swept eventually, but a client
  // should not be offered a recording that has already gone.
  const where = and(
    eq(schema.callRecordings.tenantId, s.tenantId),
    eq(schema.callRecordings.status, 'stored'),
    gt(schema.callRecordings.expiresAt, new Date())
  );

  const [{ total }] = await db.select({ total: sql<number>`count(*)` })
    .from(schema.callRecordings).where(where);

  const rows = await db.select({
    id: schema.callRecordings.id,
    callid: schema.callRecordings.callid,
    telnum: schema.callRecordings.telnum,
    direction: schema.callRecordings.direction,
    phone: schema.callRecordings.phone,
    durationSeconds: schema.callRecordings.durationSeconds,
    sizeBytes: schema.callRecordings.sizeBytes,
    transcriptStatus: schema.callRecordings.transcriptStatus,
    hasTranscript: sql<boolean>`(${schema.callRecordings.transcript} is not null)`,
    expiresAt: schema.callRecordings.expiresAt,
    createdAt: schema.callRecordings.createdAt
  }).from(schema.callRecordings).where(where)
    .orderBy(desc(schema.callRecordings.createdAt))
    .limit(p.limit).offset(p.offset);

  return paged(rows, Number(total), p);
});
