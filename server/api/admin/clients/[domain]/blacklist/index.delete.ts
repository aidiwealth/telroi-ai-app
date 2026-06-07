// DELETE /api/admin/clients/:domain/blacklist?telnum=... -> operator unblocks.
import { and, eq } from 'drizzle-orm';
import { requirePlatformAdmin } from '~/server/utils/platform';
import { apiError } from '~/server/utils/api';
import { resolveTenantByDomain } from '~/server/utils/resolve-tenant';
import { useDb, schema } from '~/server/db';
export default defineEventHandler(async (event) => {
  await requirePlatformAdmin(event);
  const t = await resolveTenantByDomain(decodeURIComponent(getRouterParam(event, 'domain')!));
  if (!t) throw apiError('not_found', 'Workspace not found', 404);
  const telnum = getQuery(event).telnum as string;
  if (!telnum) throw apiError('invalid', 'telnum required');
  const db = useDb();
  await db.delete(schema.blacklist)
    .where(and(eq(schema.blacklist.tenantId, t.id), eq(schema.blacklist.telnum, telnum)));
  try {
    const { telroiFor } = await import('~/server/utils/tenant');
    const client = await telroiFor(t.id);
    await client.deleteBlacklist([telnum]);
  } catch { /* */ }
  return { ok: true };
});
