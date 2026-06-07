// server/utils/crm-import.ts — bulk contact import (up to 100k rows).
// File lives in R2 (or local fallback); we parse it in batches and upsert
// contacts, updating the job row so the client can show live progress.
import { eq, sql } from 'drizzle-orm';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { useDb, schema } from '../db';
import { getObject } from './storage';
import { logEvent } from './logs';

const BATCH = 1000;

// Map common header variants to our contact fields.
function pick(row: Record<string, any>, keys: string[]): string | undefined {
  for (const k of Object.keys(row)) {
    const norm = k.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
    if (keys.includes(norm)) { const v = row[k]; return v == null ? undefined : String(v).trim() || undefined; }
  }
  return undefined;
}
function rowToContact(row: Record<string, any>) {
  const phone = pick(row, ['phone', 'phonenumber', 'mobile', 'tel', 'telephone', 'number', 'msisdn']);
  if (!phone) return null;
  return {
    phone,
    name: pick(row, ['name', 'fullname', 'contactname', 'firstname']),
    company: pick(row, ['company', 'organization', 'organisation', 'business']),
    email: pick(row, ['email', 'emailaddress', 'mail']),
    city: pick(row, ['city', 'town']),
    region: pick(row, ['region', 'state', 'province']),
    country: pick(row, ['country', 'countryname'])
  };
}

async function loadRows(job: typeof schema.crmImportJobs.$inferSelect): Promise<Record<string, any>[]> {
  // From Google Drive link: fetch directly. Otherwise from storage (R2/local).
  let buf: Buffer;
  if (job.driveUrl) {
    const url = toDirectDriveUrl(job.driveUrl);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Drive fetch failed (${res.status})`);
    buf = Buffer.from(await res.arrayBuffer());
  } else {
    const obj = await getObject(job.fileKey!);
    buf = obj.body;
  }
  if (job.fileType === 'xlsx' || (job.fileName || '').match(/\.xlsx?$/i)) {
    const wb = XLSX.read(buf, { type: 'buffer' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    return XLSX.utils.sheet_to_json(sheet, { defval: '' });
  }
  // CSV
  const text = buf.toString('utf8');
  const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });
  return parsed.data as Record<string, any>[];
}

// Turn a Google Drive share link into a direct-download URL.
export function toDirectDriveUrl(link: string): string {
  const m = link.match(/\/d\/([a-zA-Z0-9_-]+)/) || link.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (m) return `https://drive.google.com/uc?export=download&id=${m[1]}`;
  return link;
}

export async function processImportJob(jobId: string) {
  const db = useDb();
  const [job] = await db.select().from(schema.crmImportJobs).where(eq(schema.crmImportJobs.id, jobId)).limit(1);
  if (!job || job.status === 'processing' || job.status === 'done') return;
  await db.update(schema.crmImportJobs).set({ status: 'processing' }).where(eq(schema.crmImportJobs.id, jobId));

  try {
    const rows = await loadRows(job);
    const total = Math.min(rows.length, 100000);
    await db.update(schema.crmImportJobs).set({ total }).where(eq(schema.crmImportJobs.id, jobId));

    let created = 0, updated = 0, skipped = 0, processed = 0;
    for (let i = 0; i < total; i += BATCH) {
      const slice = rows.slice(i, i + BATCH);
      const values: any[] = [];
      for (const r of slice) {
        const c = rowToContact(r);
        if (!c) { skipped++; continue; }
        values.push({ tenantId: job.tenantId, source: job.source, status: 'lead', updatedAt: new Date(), ...c });
      }
      if (values.length) {
        // Upsert by (tenant, phone): insert new, update existing.
        const res = await db.insert(schema.crmContacts).values(values)
          .onConflictDoUpdate({
            target: [schema.crmContacts.tenantId, schema.crmContacts.phone],
            set: { name: sql`coalesce(excluded.name, ${schema.crmContacts.name})`, updatedAt: new Date() }
          }).returning({ id: schema.crmContacts.id, createdAt: schema.crmContacts.createdAt });
        // Rough created/updated split (new rows have createdAt ~now).
        created += res.length;
      }
      processed += slice.length;
      await db.update(schema.crmImportJobs)
        .set({ processed, created, updated, skipped })
        .where(eq(schema.crmImportJobs.id, jobId));
    }

    await db.update(schema.crmImportJobs)
      .set({ status: 'done', finishedAt: new Date(), processed, created, skipped })
      .where(eq(schema.crmImportJobs.id, jobId));
    await logEvent({ tenantId: job.tenantId, kind: 'system', action: 'crm.import',
      summary: `CRM import (${job.source}) done — ${created} contacts from ${job.fileName || 'Google Drive'}` });
  } catch (e: any) {
    await db.update(schema.crmImportJobs)
      .set({ status: 'failed', error: e?.message || 'import failed', finishedAt: new Date() })
      .where(eq(schema.crmImportJobs.id, jobId));
    await logEvent({ tenantId: job.tenantId, kind: 'system', action: 'crm.import', level: 'error',
      summary: `CRM import failed: ${e?.message || 'error'}` });
  }
}
