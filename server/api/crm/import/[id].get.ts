import { eq, and } from 'drizzle-orm';
import { requireTenant, apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  const db = useDb();
  const [job] = await db.select().from(schema.crmImportJobs)
    .where(and(eq(schema.crmImportJobs.id, getRouterParam(event, 'id')!), eq(schema.crmImportJobs.tenantId, s.tenantId))).limit(1);
  if (!job) throw apiError('not_found', 'Import not found', 404);
  return { job };
});
