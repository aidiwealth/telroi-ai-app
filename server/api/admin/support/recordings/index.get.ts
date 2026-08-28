// GET /api/admin/support/recordings -> the support workspace's recordings.
//
// The same list the client sees for their own workspace: an operator reviewing
// a call they handled needs the audio for the same reasons anybody does.
import { eq, desc, and, gt } from 'drizzle-orm';
import { requirePlatformAdmin } from '~/server/utils/platform';
import { ensureSupportWorkspace } from '~/server/utils/support';
import { useDb, schema } from '~/server/db';

export default defineEventHandler(async (event) => {
  await requirePlatformAdmin(event);
  const ws = await ensureSupportWorkspace();
  const q = getQuery(event);
  const page = Math.max(1, Number(q.page) || 1);
  const perPage = Math.min(100, Number(q.perPage) || 50);

  const rows = await useDb().select({
    id: schema.callRecordings.id,
    callid: schema.callRecordings.callid,
    telnum: schema.callRecordings.telnum,
    durationSeconds: schema.callRecordings.durationSeconds,
    status: schema.callRecordings.status,
    transcriptStatus: schema.callRecordings.transcriptStatus,
    createdAt: schema.callRecordings.createdAt,
    expiresAt: schema.callRecordings.expiresAt
  }).from(schema.callRecordings)
    .where(and(eq(schema.callRecordings.tenantId, ws.tenantId),
               gt(schema.callRecordings.expiresAt, new Date())))
    .orderBy(desc(schema.callRecordings.createdAt))
    .limit(perPage).offset((page - 1) * perPage);

  return { items: rows, page, perPage };
});
