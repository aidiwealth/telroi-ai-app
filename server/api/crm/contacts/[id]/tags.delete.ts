// DELETE /api/crm/contacts/:id/tags?tagId=...
//
// Takes a tag off a contact. The tag itself survives — it is still in the
// workspace's set and probably on other contacts, and removing it everywhere
// because one person no longer needs it would be a surprise.
import { and, eq } from 'drizzle-orm';
import { requireTenant, apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';

export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  const contactId = getRouterParam(event, 'id') || '';
  const tagId = String(getQuery(event).tagId || '');
  if (!contactId || !tagId) throw apiError('invalid', 'tagId is required');

  const db = useDb();
  await db.delete(schema.crmContactTags).where(and(
    eq(schema.crmContactTags.contactId, contactId),
    eq(schema.crmContactTags.tagId, tagId),
    // Scoped, so an id from another workspace cannot be used to unpick theirs.
    eq(schema.crmContactTags.tenantId, s.tenantId)
  ));
  return { ok: true };
});
