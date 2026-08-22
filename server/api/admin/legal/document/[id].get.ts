// GET /api/admin/legal/document/:id -> one version, by id.
//
// By id and not by slug: the current wording is not evidence of what somebody
// accepted two versions ago, and the register exists precisely to answer that.
import { eq } from 'drizzle-orm';
import { requireSuperAdmin } from '~/server/utils/platform';
import { apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';

export default defineEventHandler(async (event) => {
  await requireSuperAdmin(event);
  const id = getRouterParam(event, 'id')!;
  const [doc] = await useDb().select().from(schema.legalDocuments)
    .where(eq(schema.legalDocuments.id, id)).limit(1);
  if (!doc) throw apiError('not_found', 'No such version', 404);
  return { document: doc };
});
