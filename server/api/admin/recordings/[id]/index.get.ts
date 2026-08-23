// GET /api/admin/recordings/:id -> a recording and its transcript.
//
// Reading somebody's conversation is the same kind of act as listening to it,
// so it is logged by name exactly as playback is.
import { eq } from 'drizzle-orm';
import { requirePlatformAdmin } from '~/server/utils/platform';
import { apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
import { logEvent } from '~/server/utils/logs';

export default defineEventHandler(async (event) => {
  const admin = await requirePlatformAdmin(event);
  const id = getRouterParam(event, 'id')!;
  const [rec] = await useDb().select().from(schema.callRecordings)
    .where(eq(schema.callRecordings.id, id)).limit(1);
  if (!rec) throw apiError('not_found', 'No such recording', 404);

  if (rec.transcript) {
    await logEvent({
      tenantId: rec.tenantId, kind: 'audit', action: 'recording.transcript_read',
      summary: `${admin.email} read the transcript of ${rec.telnum || rec.callid}`
    });
  }

  return {
    recording: {
      id: rec.id, callid: rec.callid, telnum: rec.telnum,
      durationSeconds: rec.durationSeconds, status: rec.status,
      transcript: rec.transcript, transcriptStatus: rec.transcriptStatus,
      createdAt: rec.createdAt
    }
  };
});
