// GET /api/admin/support/recordings/:id -> one recording, with its transcript.
//
// The list carries only whether a transcript exists; this is for the drawer,
// which shows one at a time.
import { and, eq } from 'drizzle-orm';
import { requirePlatformAdmin } from '~/server/utils/platform';
import { ensureSupportWorkspace } from '~/server/utils/support';
import { apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';

export default defineEventHandler(async (event) => {
  await requirePlatformAdmin(event);
  const ws = await ensureSupportWorkspace();
  const id = getRouterParam(event, 'id')!;

  // Scoped to the support workspace as well as the id: an operator reads their
  // own workspace's recordings here, not any recording whose id they hold.
  const [rec] = await useDb().select().from(schema.callRecordings)
    .where(and(eq(schema.callRecordings.id, id),
               eq(schema.callRecordings.tenantId, ws.tenantId))).limit(1);
  if (!rec) throw apiError('not_found', 'No such recording', 404);

  return {
    recording: {
      id: rec.id, callid: rec.callid, telnum: rec.telnum,
      durationSeconds: rec.durationSeconds, status: rec.status,
      transcript: rec.transcript, transcriptStatus: rec.transcriptStatus,
      createdAt: rec.createdAt, expiresAt: rec.expiresAt
    }
  };
});
