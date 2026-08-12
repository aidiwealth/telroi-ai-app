// GET /api/voice/recordings/:id/audio -> play a recording.
//
// Streamed through us rather than handed out as a storage URL: the bucket stays
// private, and a link that works for anyone who finds it is not what we want for
// a recording of somebody's conversation.
import { eq, and } from 'drizzle-orm';
import { requireTenant, apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
import { getObject } from '~/server/utils/storage';

export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  const id = getRouterParam(event, 'id')!;

  const [rec] = await useDb().select().from(schema.callRecordings)
    .where(and(eq(schema.callRecordings.id, id), eq(schema.callRecordings.tenantId, s.tenantId)))
    .limit(1);
  if (!rec?.objectKey) throw apiError('not_found', 'That recording is not available', 404);
  if (rec.expiresAt && rec.expiresAt < new Date()) {
    throw apiError('expired', 'That recording has passed its retention period', 410);
  }

  const obj = await getObject(rec.objectKey).catch(() => null);
  if (!obj?.body) throw apiError('not_found', 'That recording is not available', 404);

  setHeader(event, 'Content-Type', rec.contentType || 'audio/wav');
  setHeader(event, 'Cache-Control', 'private, max-age=3600');
  return obj.body;
});
