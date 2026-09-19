// GET /api/admin/support/crm/tags — the support workspace's own tags.
import { eq, sql, desc } from 'drizzle-orm';
import { requirePlatformAdmin } from '~/server/utils/platform';
import { ensureSupportWorkspace } from '~/server/utils/support';
import { useDb, schema } from '~/server/db';

export default defineEventHandler(async (event) => {
  await requirePlatformAdmin(event);
  const { tenantId } = await ensureSupportWorkspace();
  const db = useDb();

  const rows = await db.select({
    id: schema.crmTags.id,
    name: schema.crmTags.name,
    color: schema.crmTags.color,
    count: sql<number>`count(${schema.crmContactTags.contactId})::int`
  }).from(schema.crmTags)
    .leftJoin(schema.crmContactTags, eq(schema.crmContactTags.tagId, schema.crmTags.id))
    .where(eq(schema.crmTags.tenantId, tenantId))
    .groupBy(schema.crmTags.id, schema.crmTags.name, schema.crmTags.color)
    .orderBy(desc(sql`count(${schema.crmContactTags.contactId})`), schema.crmTags.name);

  return { tags: rows };
});
