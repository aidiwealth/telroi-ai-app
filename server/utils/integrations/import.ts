// server/utils/integrations/import.ts
// Imports contacts FROM a connected CRM into Telroi's own CRM (import direction).
// Paginates through the provider, upserts each contact by phone, and records
// progress/health on the integration row. Bounded so a single run can't hammer
// the provider or run unbounded.
import { eq } from 'drizzle-orm';
import { useDb, schema } from '../../db';
import { decrypt } from '../crypto';
import { adapterFor } from './providers';
import { upsertContactByPhone } from '../crm';

export async function importContacts(tenantId: string, provider: string, opts: { maxPages?: number } = {}): Promise<{ imported: number; skipped: number; pages: number }> {
  const db = useDb();
  const [conn] = await db.select().from(schema.integrations)
    .where(eq(schema.integrations.tenantId, tenantId)).limit(1).then((rows) => rows.filter((r) => r.provider === provider));
  if (!conn || !conn.credentialsEnc) throw new Error('Integration not connected');
  const adapter = adapterFor(provider);
  if (!adapter) throw new Error('Unsupported provider');
  let creds = JSON.parse(decrypt(conn.credentialsEnc));
  try { const { ensureValidCreds } = await import('./tokens'); creds = await ensureValidCreds(conn.id, provider, creds); } catch (e: any) { throw new Error(e?.message || 'Token refresh failed'); }

  let imported = 0, skipped = 0, pages = 0;
  let cursor: string | undefined;
  const maxPages = opts.maxPages || 25; // safety bound (≈2500 contacts/run)
  try {
    do {
      const { contacts, nextCursor } = await adapter.listContacts(creds, { cursor, limit: 100 });
      for (const c of contacts) {
        if (!c.phone) { skipped++; continue; }
        await upsertContactByPhone(tenantId, c.phone, {
          name: c.name || [c.firstName, c.lastName].filter(Boolean).join(' ') || undefined,
          email: c.email || undefined,
          company: c.company || undefined,
          source: provider.charAt(0).toUpperCase() + provider.slice(1),
          status: 'lead'
        });
        imported++;
      }
      cursor = nextCursor;
      pages++;
    } while (cursor && pages < maxPages);

    await db.update(schema.integrations)
      .set({ lastImportAt: new Date(), importedCount: (conn.importedCount || 0) + imported, lastSyncedAt: new Date(), lastSyncError: null, status: 'connected' })
      .where(eq(schema.integrations.id, conn.id));
  } catch (e: any) {
    await db.update(schema.integrations).set({ lastSyncError: String(e?.message || e).slice(0, 300), status: 'error' }).where(eq(schema.integrations.id, conn.id));
    throw e;
  }
  return { imported, skipped, pages };
}
