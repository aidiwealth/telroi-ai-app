// POST /api/crm/contacts/:id/tags { name }
//
// Put a tag on a contact, creating it if this workspace has not used it before.
// One step rather than two: nobody thinks of "create the tag" and "apply the
// tag" as separate acts, and every tagging interface people already know works
// this way.
//
// Matched case-insensitively against what exists, so typing "VIP" when the
// workspace already has "vip" reuses theirs rather than making a near-duplicate
// nobody can tell apart in a list.
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { requireTenant, apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';

const Body = z.object({
  name: z.string().min(1).max(40).transform((v) => v.trim()),
  color: z.string().max(16).optional()
});

export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  const contactId = getRouterParam(event, 'id') || '';
  const p = Body.safeParse(await readBody(event));
  if (!p.success) throw apiError('invalid', 'A tag name of up to 40 characters is required');
  if (!p.data.name) throw apiError('invalid', 'A tag name is required');
  const db = useDb();

  // Theirs, not somebody else's: an id from another workspace must not be
  // taggable by guessing it.
  const [contact] = await db.select({ id: schema.crmContacts.id })
    .from(schema.crmContacts)
    .where(and(eq(schema.crmContacts.id, contactId), eq(schema.crmContacts.tenantId, s.tenantId)))
    .limit(1);
  if (!contact) throw apiError('not_found', 'Contact not found', 404);

  const [existing] = await db.select().from(schema.crmTags)
    .where(and(
      eq(schema.crmTags.tenantId, s.tenantId),
      sql`lower(${schema.crmTags.name}) = lower(${p.data.name})`
    )).limit(1);

  let tag = existing;
  if (!tag) {
    [tag] = await db.insert(schema.crmTags)
      .values({ tenantId: s.tenantId, name: p.data.name, color: p.data.color || null })
      .returning();
  }

  await db.insert(schema.crmContactTags)
    .values({ contactId, tagId: tag.id, tenantId: s.tenantId })
    .onConflictDoNothing();

  return { ok: true, tag: { id: tag.id, name: tag.name, color: tag.color } };
});
