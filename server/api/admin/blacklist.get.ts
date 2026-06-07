// GET /api/admin/blacklist -> GLOBAL view of every client's blocked numbers,
// across all workspaces. Each client's blacklist remains private to that client;
// only the operator sees the combined list here. Read-only. Platform-admin only.
import { eq, desc } from 'drizzle-orm';
import { requirePlatformAdmin } from '~/server/utils/platform';
import { useDb, schema } from '~/server/db';
export default defineEventHandler(async (event) => {
  await requirePlatformAdmin(event);
  const db = useDb();
  // Join each entry to its owning workspace so the operator sees who blocked what.
  const rows = await db.select({
    id: schema.blacklist.id,
    telnum: schema.blacklist.telnum,
    comment: schema.blacklist.comment,
    createdAt: schema.blacklist.createdAt,
    tenantId: schema.blacklist.tenantId,
    clientName: schema.tenants.name,
    clientSlug: schema.tenants.slug
  })
    .from(schema.blacklist)
    .leftJoin(schema.tenants, eq(schema.blacklist.tenantId, schema.tenants.id))
    .orderBy(desc(schema.blacklist.createdAt));
  return { items: rows, total: rows.length };
});
