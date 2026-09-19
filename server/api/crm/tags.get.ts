// GET /api/crm/tags — every tag this workspace has created, with how many
// contacts carry each.
//
// The count is what makes the list useful rather than decorative: it shows
// which tags are doing work and which were typed once and forgotten, and it is
// what a picker sorts by so the ones in use come first.
import { eq, sql, desc } from 'drizzle-orm';
import { requireTenant } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';

export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  const db = useDb();

  const rows = await db.select({
    id: schema.crmTags.id,
    name: schema.crmTags.name,
    color: schema.crmTags.color,
    count: sql<number>`count(${schema.crmContactTags.contactId})::int`
  }).from(schema.crmTags)
    .leftJoin(schema.crmContactTags, eq(schema.crmContactTags.tagId, schema.crmTags.id))
    .where(eq(schema.crmTags.tenantId, s.tenantId))
    .groupBy(schema.crmTags.id, schema.crmTags.name, schema.crmTags.color)
    .orderBy(desc(sql`count(${schema.crmContactTags.contactId})`), schema.crmTags.name);

  return { tags: rows };
});
