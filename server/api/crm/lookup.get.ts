// GET /api/crm/lookup?phone=+234...
//
// Who is this number? Asked from the call view, where somebody looking at a
// call wants the person rather than the digits — their name, their company,
// and the tags the workspace has put on them.
//
// Matched on the last nine digits, as the CRM's own call history does: the same
// person arrives as +2348027016644, 08027016644 and 8027016644 depending on who
// is telling us, and a client should not have to care which.
import { and, eq, sql } from 'drizzle-orm';
import { requireTenant } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';

export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  const phone = String(getQuery(event).phone || '');
  const suffix = phone.replace(/\D/g, '').slice(-9);
  // Nothing to match on is not an error: an anonymous caller simply has no
  // contact, and the drawer shows the number as before.
  if (!suffix) return { contact: null };

  const db = useDb();
  const [c] = await db.select({
    id: schema.crmContacts.id,
    name: schema.crmContacts.name,
    company: schema.crmContacts.company,
    status: schema.crmContacts.status
  }).from(schema.crmContacts)
    .where(and(
      eq(schema.crmContacts.tenantId, s.tenantId),
      sql`right(regexp_replace(${schema.crmContacts.phone}, '\\D', '', 'g'), 9) = ${suffix}`
    )).limit(1);
  if (!c) return { contact: null };

  const tags = await db.select({
    id: schema.crmTags.id, name: schema.crmTags.name, color: schema.crmTags.color
  }).from(schema.crmContactTags)
    .innerJoin(schema.crmTags, eq(schema.crmTags.id, schema.crmContactTags.tagId))
    .where(eq(schema.crmContactTags.contactId, c.id))
    .orderBy(schema.crmTags.name);

  return { contact: { ...c, tags } };
});
