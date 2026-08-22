// GET /api/voice/recordings/:id -> one recording, with its transcript.
//
// The list returns only whether a transcript exists, because carrying the full
// text of every recording on a page would be pointless weight. This is for the
// drawer, which shows one at a time.
import { and, eq } from 'drizzle-orm';
import { requireTenant, apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';

export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  const id = getRouterParam(event, 'id')!;
  const [rec] = await useDb().select({
    id: schema.callRecordings.id,
    callid: schema.callRecordings.callid,
    durationSeconds: schema.callRecordings.durationSeconds,
    status: schema.callRecordings.status,
    transcript: schema.callRecordings.transcript,
    transcriptStatus: schema.callRecordings.transcriptStatus,
    // How long the audio has left, so somebody deciding whether to transcribe
    // knows whether it is a decision or a deadline.
    expiresAt: schema.callRecordings.expiresAt,
    createdAt: schema.callRecordings.createdAt
  }).from(schema.callRecordings)
    .where(and(eq(schema.callRecordings.id, id), eq(schema.callRecordings.tenantId, s.tenantId)))
    .limit(1);
  if (!rec) throw apiError('not_found', 'No such recording', 404);
  return { recording: rec };
});
