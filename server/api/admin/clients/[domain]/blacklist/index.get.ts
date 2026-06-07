// GET /api/admin/clients/:domain/blacklist -> a client's block list (operator view).
import { eq, desc } from 'drizzle-orm';
import { requirePlatformAdmin } from '~/server/utils/platform';
import { apiError } from '~/server/utils/api';
import { resolveTenantByDomain } from '~/server/utils/resolve-tenant';
import { useDb, schema } from '~/server/db';
export default defineEventHandler(async (event) => {
  await requirePlatformAdmin(event);
  const t = await resolveTenantByDomain(decodeURIComponent(getRouterParam(event, 'domain')!));
  if (!t) throw apiError('not_found', 'Workspace not found', 404);
  const db = useDb();
  const items = await db.select().from(schema.blacklist)
    .where(eq(schema.blacklist.tenantId, t.id)).orderBy(desc(schema.blacklist.createdAt));
  return { items };
});
