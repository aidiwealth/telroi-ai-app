import { eq, and } from 'drizzle-orm';
import { requirePlatformAdmin } from '~/server/utils/platform';
import { apiError } from '~/server/utils/api';
import { ensureSupportWorkspace } from '~/server/utils/support';
import { useDb, schema } from '~/server/db';
export default defineEventHandler(async (event) => {
  await requirePlatformAdmin(event);
  const ws = await ensureSupportWorkspace();
  const db = useDb();
  const [job] = await db.select().from(schema.crmImportJobs)
    .where(and(eq(schema.crmImportJobs.id, getRouterParam(event, 'id')!), eq(schema.crmImportJobs.tenantId, ws.tenantId))).limit(1);
  if (!job) throw apiError('not_found', 'Import not found', 404);
  return { job };
});
