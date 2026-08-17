// server/utils/crm.ts — Telroi One CRM operations (paid suite).
import { and, eq, desc, ilike, or, sql, inArray, isNull, isNotNull } from 'drizzle-orm';
import { useDb, schema } from '../db';

export async function listContacts(tenantId: string, opts: { q?: string; status?: string; sources?: string[]; limit?: number; offset?: number; archived?: boolean } = {}) {
  const db = useDb();
  const conds: any[] = [eq(schema.crmContacts.tenantId, tenantId)];
  // Deleted contacts never appear. Archived ones only when asked for, so the
  // board shows the people somebody is actually working with.
  conds.push(isNull(schema.crmContacts.deletedAt));
  conds.push(opts.archived ? isNotNull(schema.crmContacts.archivedAt) : isNull(schema.crmContacts.archivedAt));
  if (opts.status && opts.status !== 'all') conds.push(eq(schema.crmContacts.status, opts.status));
  if (opts.sources && opts.sources.length) conds.push(inArray(schema.crmContacts.source, opts.sources));
  if (opts.q) {
    const like = `%${opts.q}%`;
    conds.push(or(ilike(schema.crmContacts.name, like), ilike(schema.crmContacts.company, like), ilike(schema.crmContacts.phone, like), ilike(schema.crmContacts.email, like)));
  }
  // The same conditions count as list, so the total reflects the filter rather
  // than the whole book — "3 of 12,000" when searching for one name would be
  // worse than useless.
  const [{ total }] = await db.select({ total: sql<number>`count(*)` })
    .from(schema.crmContacts).where(and(...conds));

  const items = await db.select().from(schema.crmContacts)
    .where(and(...conds))
    .orderBy(desc(schema.crmContacts.updatedAt))
    .limit(opts.limit || 50).offset(opts.offset || 0);

  return { items, total: Number(total) };
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

/** Soft, for two reasons. The notes and call history record real conversations
 *  and should survive a tidy-up; and a hard delete did not stick — the call sync
 *  recreated the contact the next time that number rang, so deleting achieved
 *  nothing beyond losing the notes. */
export async function deleteContact(tenantId: string, id: string) {
  const db = useDb();
  await db.update(schema.crmContacts)
    .set({ deletedAt: new Date() })
    .where(and(eq(schema.crmContacts.id, id), eq(schema.crmContacts.tenantId, tenantId)));
  return { ok: true };
}

/** Off the board, still theirs. Reversible, because a contact put away in error
 *  should come back without ceremony. */
export async function archiveContact(tenantId: string, id: string, archived: boolean) {
  const db = useDb();
  await db.update(schema.crmContacts)
    .set({ archivedAt: archived ? new Date() : null })
    .where(and(eq(schema.crmContacts.id, id), eq(schema.crmContacts.tenantId, tenantId)));
  return { ok: true };
}

export async function addNote(tenantId: string, contactId: string, authorUserId: string, body: string, kind: string = 'note', callUid?: string) {
  const db = useDb();
  // Check the contact is ours before writing against it. The ownership test was
  // only on the lastContactedAt update below, which meant a note could be stored
  // referencing a contact in another workspace — invisible to them, but not
  // something we should be recording.
  const [owned] = await db.select({ id: schema.crmContacts.id }).from(schema.crmContacts)
    .where(and(eq(schema.crmContacts.id, contactId), eq(schema.crmContacts.tenantId, tenantId))).limit(1);
  if (!owned) return null;

  const [row] = await db.insert(schema.crmContactNotes)
    .values({ tenantId, contactId, authorUserId, body, kind, callUid: callUid || null }).returning();
  await db.update(schema.crmContacts).set({ lastContactedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(schema.crmContacts.id, contactId), eq(schema.crmContacts.tenantId, tenantId)));
  return row;
}

// Auto-link an inbound web/phone call to a contact: find by phone or create a
// lightweight contact. Used by the Live Call widget + inbound webhooks.
export async function upsertContactByPhone(tenantId: string, rawPhone: string, extra: Partial<typeof schema.crmContacts.$inferInsert> = {}) {
  const db = useDb();
  // One way to write a number, or the same person becomes several contacts. Our
  // Nigerian carrier presents inbound callers as 00 plus the national number with
  // the trunk zero stripped, so 008027016644 never matched the +2348027016644 we
  // already held for them.
  const { normalizePhone } = await import('./phone');
  const phone = normalizePhone(rawPhone);
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

// Sync recent inbound call numbers into the CRM as contacts. Idempotent: the
// unique (tenant, phone) constraint means re-running only adds genuinely new
// numbers. Respects the tenant's autoLinkCalls CRM setting. Best-effort — a
// failure here must never block the contacts list from loading.
export async function syncCallsToContacts(tenantId: string, opts: { days?: number; limit?: number } = {}) {
  try {
    const { hasFeature } = await import('./entitlements');
    if (!(await hasFeature(tenantId, 'crm'))) return 0;
    const { effectiveSettings } = await import('./feature-settings');
    const eff = await effectiveSettings(tenantId, 'crm');
    if (eff.settings.autoLinkCalls === false) return 0;

    const db = useDb();
    const since = new Date(Date.now() - (opts.days ?? 90) * 24 * 3600 * 1000);
    const rows = await db.select({ phone: schema.callEvents.phone })
      .from(schema.callEvents)
      .where(and(
        eq(schema.callEvents.tenantId, tenantId),
        // Both directions. Inbound only meant somebody you rang who had never
        // rung you simply was not there — which is half a CRM.

        sql`${schema.callEvents.phone} is not null and ${schema.callEvents.phone} <> ''`,
        sql`${schema.callEvents.startedAt} >= ${since.toISOString()}`
      ))
      .orderBy(desc(schema.callEvents.startedAt))
      .limit(opts.limit ?? 500);

    let phones = Array.from(new Set(rows.map((r) => (r.phone || '').trim()).filter(Boolean)));

    // Numbers somebody deliberately removed. Without this the sync would put
    // them back the next time they rang, and deleting would mean nothing —
    // which is why the delete is soft in the first place.
    const gone = await db.select({ phone: schema.crmContacts.phone })
      .from(schema.crmContacts)
      .where(and(eq(schema.crmContacts.tenantId, tenantId), isNotNull(schema.crmContacts.deletedAt)));
    const goneSet = new Set(gone.map((g) => (g.phone || '').replace(/\D/g, '').slice(-9)).filter(Boolean));
    if (goneSet.size) phones = phones.filter((p) => !goneSet.has(p.replace(/\D/g, '').slice(-9)));
    if (!phones.length) return 0;

    const existing = await db.select({ phone: schema.crmContacts.phone })
      .from(schema.crmContacts)
      .where(and(eq(schema.crmContacts.tenantId, tenantId), inArray(schema.crmContacts.phone, phones)));
    const have = new Set(existing.map((e) => e.phone));
    const toAdd = phones.filter((p) => !have.has(p));

    const status = (eff.settings.defaultStatus as string) || 'lead';
    let added = 0;
    for (const phone of toAdd) {
      const row = await upsertContactByPhone(tenantId, phone, { source: 'inbound', status });
      if (row) added++;
    }
    return added;
  } catch {
    return 0;
  }
}
