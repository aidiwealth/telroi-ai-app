// GET /api/admin/recordings/:id/audio -> play any client's recording.
//
// Logged, because listening to somebody's conversation is a thing an operator
// should have to answer for.
import { eq } from 'drizzle-orm';
import { requirePlatformAdmin } from '~/server/utils/platform';
import { apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
import { getObject } from '~/server/utils/storage';
import { logEvent } from '~/server/utils/logs';

export default defineEventHandler(async (event) => {
  const admin = await requirePlatformAdmin(event);
  const id = getRouterParam(event, 'id')!;

  const [rec] = await useDb().select().from(schema.callRecordings)
    .where(eq(schema.callRecordings.id, id)).limit(1);
  if (!rec?.objectKey) throw apiError('not_found', 'That recording is not available', 404);

  const obj = await getObject(rec.objectKey).catch(() => null);
  if (!obj?.body) throw apiError('not_found', 'That recording is not available', 404);

  await logEvent({
    tenantId: rec.tenantId, kind: 'system', action: 'recording.played',
    summary: `${admin.email} listened to a recording of ${rec.phone || 'a call'}`
  });

  setHeader(event, 'Content-Type', rec.contentType || 'audio/wav');
  setHeader(event, 'Cache-Control', 'private, max-age=3600');
  return obj.body;
});
