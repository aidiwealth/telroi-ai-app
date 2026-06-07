// server/utils/crm.ts — Telroi One CRM operations (paid suite).
import { and, eq, desc, ilike, or, sql, inArray } from 'drizzle-orm';
import { useDb, schema } from '../db';

export async function listContacts(tenantId: string, opts: { q?: string; status?: string; sources?: string[]; limit?: number } = {}) {
  const db = useDb();
  const conds: any[] = [eq(schema.crmContacts.tenantId, tenantId)];
  if (opts.status && opts.status !== 'all') conds.push(eq(schema.crmContacts.status, opts.status));
  if (opts.sources && opts.sources.length) conds.push(inArray(schema.crmContacts.source, opts.sources));
  if (opts.q) {
    const like = `%${opts.q}%`;
    conds.push(or(ilike(schema.crmContacts.name, like), ilike(schema.crmContacts.company, like), ilike(schema.crmContacts.phone, like), ilike(schema.crmContacts.email, like)));
  }
  return db.select().from(schema.crmContacts)
    .where(and(...conds))
    .orderBy(desc(schema.crmContacts.updatedAt))
    .limit(Math.min(opts.limit || 200, 500));
}

export async function getContact(tenantId: string, id: string) {
  const db = useDb();
  const [c] = await db.select().from(schema.crmContacts)
    .where(and(eq(schema.crmContacts.id, id), eq(schema.crmContacts.tenantId, tenantId))).limit(1);
  if (!c) return null;
  const notes = await db.select().from(schema.crmContactNotes)
    .where(eq(schema.crmContactNotes.contactId, id)).orderBy(desc(schema.crmContactNotes.createdAt));
  // Call history: match callEvents by phone (last 9 digits to be tolerant of formatting).
  let calls: any[] = [];
  if (c.phone) {
    const suffix = c.phone.replace(/\D/g, '').slice(-9);
    if (suffix) {
      calls = await db.select().from(schema.callEvents)
        .where(and(eq(schema.callEvents.tenantId, tenantId), sql`right(regexp_replace(${schema.callEvents.phone}, '\\D', '', 'g'), 9) = ${suffix}`))
        .orderBy(desc(schema.callEvents.startedAt)).limit(50);
    }
  }
  return { ...c, notes, calls };
}

export async function createContact(tenantId: string, data: Partial<typeof schema.crmContacts.$inferInsert>) {
  const db = useDb();
  const [row] = await db.insert(schema.crmContacts)
    .values({ ...data, tenantId, updatedAt: new Date() })
    .onConflictDoNothing()
    .returning();
  return row;
}

export async function updateContact(tenantId: string, id: string, patch: Partial<typeof schema.crmContacts.$inferInsert>) {
  const db = useDb();
  const [row] = await db.update(schema.crmContacts)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(schema.crmContacts.id, id), eq(schema.crmContacts.tenantId, tenantId))).returning();
  return row;
}

export async function deleteContact(tenantId: string, id: string) {
  const db = useDb();
  await db.delete(schema.crmContacts)
    .where(and(eq(schema.crmContacts.id, id), eq(schema.crmContacts.tenantId, tenantId)));
  return { ok: true };
}

export async function addNote(tenantId: string, contactId: string, authorUserId: string, body: string, kind: string = 'note', callUid?: string) {
  const db = useDb();
  const [row] = await db.insert(schema.crmContactNotes)
    .values({ tenantId, contactId, authorUserId, body, kind, callUid: callUid || null }).returning();
  await db.update(schema.crmContacts).set({ lastContactedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(schema.crmContacts.id, contactId), eq(schema.crmContacts.tenantId, tenantId)));
  return row;
}

// Auto-link an inbound web/phone call to a contact: find by phone or create a
// lightweight contact. Used by the Live Call widget + inbound webhooks.
export async function upsertContactByPhone(tenantId: string, phone: string, extra: Partial<typeof schema.crmContacts.$inferInsert> = {}) {
  const db = useDb();
  const [existing] = await db.select().from(schema.crmContacts)
    .where(and(eq(schema.crmContacts.tenantId, tenantId), eq(schema.crmContacts.phone, phone))).limit(1);
  if (existing) {
    if (Object.keys(extra).length) {
      await db.update(schema.crmContacts).set({ ...extra, updatedAt: new Date() }).where(eq(schema.crmContacts.id, existing.id));
    }
    return existing;
  }
  const [row] = await db.insert(schema.crmContacts)
    .values({ tenantId, phone, source: extra.source || 'web_call', status: 'lead', ...extra, updatedAt: new Date() })
    .onConflictDoNothing().returning();
  return row;
}
