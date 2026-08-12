// GET /api/documents/:slug -> download a document we ask clients to sign.
//
// Streamed rather than handed out as a storage URL: the bucket stays private,
// and a link that works for anyone who finds it is not what we want for a form
// carrying our name.
import { eq } from 'drizzle-orm';
import { requireTenant, apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
import { getObject } from '~/server/utils/storage';

export default defineEventHandler(async (event) => {
  await requireTenant(event);
  const slug = getRouterParam(event, 'slug')!;
  const [doc] = await useDb().select().from(schema.platformDocuments)
    .where(eq(schema.platformDocuments.slug, slug)).limit(1);
  if (!doc) throw apiError('not_found', 'That document is not available', 404);

  const obj = await getObject(doc.objectKey).catch(() => null);
  if (!obj?.body) throw apiError('not_found', 'That document is not available', 404);

  setHeader(event, 'Content-Type', obj.contentType || doc.contentType);
  setHeader(event, 'Content-Disposition', `attachment; filename="${doc.filename.replace(/"/g, '')}"`);
  return obj.body;
});
