// GET /api/admin/documents -> what clients can download from us.
import { desc } from 'drizzle-orm';
import { requirePlatformAdmin } from '~/server/utils/platform';
import { useDb, schema } from '~/server/db';

export default defineEventHandler(async (event) => {
  await requirePlatformAdmin(event);
  const rows = await useDb().select().from(schema.platformDocuments)
    .orderBy(desc(schema.platformDocuments.updatedAt));
  // The object key stays here: it is where the file sits in storage, and a
  // browser has no use for it.
  return { documents: rows.map((d) => ({
    id: d.id, slug: d.slug, title: d.title, description: d.description,
    filename: d.filename, contentType: d.contentType, sizeBytes: d.sizeBytes,
    country: d.country, uploadedBy: d.uploadedBy, updatedAt: d.updatedAt
  })) };
});
