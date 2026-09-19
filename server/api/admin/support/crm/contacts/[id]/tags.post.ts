// POST /api/admin/support/crm/contacts/:id/tags { name }
//
// The same as the client endpoint, against the support workspace. Our own team
// tags the people who ring support for the same reason a client tags theirs —
// so the next person picking up knows who this is before they speak.
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { requirePlatformAdmin } from '~/server/utils/platform';
import { ensureSupportWorkspace } from '~/server/utils/support';
import { apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';

const Body = z.object({
  name: z.string().min(1).max(40).transform((v) => v.trim()),
  color: z.string().max(16).optional()
});

export default defineEventHandler(async (event) => {
  await requirePlatformAdmin(event);
  const { tenantId } = await ensureSupportWorkspace();
  const contactId = getRouterParam(event, 'id') || '';
  const p = Body.safeParse(await readBody(event));
  if (!p.success || !p.data.name) throw apiError('invalid', 'A tag name of up to 40 characters is required');
  const db = useDb();

  const [contact] = await db.select({ id: schema.crmContacts.id })
    .from(schema.crmContacts)
    .where(and(eq(schema.crmContacts.id, contactId), eq(schema.crmContacts.tenantId, tenantId)))
    .limit(1);
  if (!contact) throw apiError('not_found', 'Contact not found', 404);

  const [existing] = await db.select().from(schema.crmTags)
    .where(and(eq(schema.crmTags.tenantId, tenantId), sql`lower(${schema.crmTags.name}) = lower(${p.data.name})`))
    .limit(1);
  let tag = existing;
  if (!tag) {
    [tag] = await db.insert(schema.crmTags)
      .values({ tenantId, name: p.data.name, color: p.data.color || null }).returning();
  }
  await db.insert(schema.crmContactTags)
    .values({ contactId, tagId: tag.id, tenantId }).onConflictDoNothing();
  return { ok: true, tag: { id: tag.id, name: tag.name, color: tag.color } };
});
