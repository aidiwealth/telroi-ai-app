// GET /api/legal/:slug -> the version of a document currently in force.
//
// Returns the text itself, because a client cannot meaningfully accept wording
// they have not been shown, and the acceptance we record has to correspond to
// something they actually read.
import { and, eq } from 'drizzle-orm';
import { requireTenant, apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';

export default defineEventHandler(async (event) => {
  await requireTenant(event);
  const slug = getRouterParam(event, 'slug')!;
  const [doc] = await useDb().select().from(schema.legalDocuments)
    .where(and(eq(schema.legalDocuments.slug, slug), eq(schema.legalDocuments.isCurrent, true)))
    .limit(1);
  if (!doc) throw apiError('not_found', 'That document is not available', 404);
  return { document: { id: doc.id, slug: doc.slug, version: doc.version, title: doc.title, body: doc.body, effectiveAt: doc.effectiveAt } };
});
