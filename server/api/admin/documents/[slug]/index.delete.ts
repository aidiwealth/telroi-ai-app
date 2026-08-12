// DELETE /api/admin/documents/:slug -> stop offering a document.
//
// The stored object is left alone: a client may be part-way through signing it,
// and an orphaned file costs pennies where a broken download costs a go-live.
import { eq } from 'drizzle-orm';
import { requirePlatformAdmin } from '~/server/utils/platform';
import { apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
import { logEvent } from '~/server/utils/logs';

export default defineEventHandler(async (event) => {
  const admin = await requirePlatformAdmin(event);
  const slug = getRouterParam(event, 'slug')!;
  const db = useDb();
  const [doc] = await db.select().from(schema.platformDocuments)
    .where(eq(schema.platformDocuments.slug, slug)).limit(1);
  if (!doc) throw apiError('not_found', 'Document not found', 404);

  await db.delete(schema.platformDocuments).where(eq(schema.platformDocuments.id, doc.id));
  await logEvent({ kind: 'system', action: 'document.remove', summary: `${admin.email} removed "${doc.title}"` });
  return { ok: true };
});
