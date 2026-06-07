// server/utils/blacklist.ts
// Carrier-agnostic outbound blocklist. Stored locally (per tenant) so it's
// enforced for EVERY outbound path regardless of carrier, not just Digidite/PBX.
// A number is blocked if it exactly matches, or if a stored entry is a prefix
// of the dialed number (range block).
import { and, eq } from 'drizzle-orm';
import { useDb, schema } from '../db';

function normalize(n: string) { return String(n || '').replace(/[^\d+]/g, ''); }

export async function isBlacklisted(tenantId: string, to: string): Promise<boolean> {
  const db = useDb();
  const target = normalize(to);
  if (!target) return false;
  const rows = await db.select({ telnum: schema.blacklist.telnum })
    .from(schema.blacklist).where(eq(schema.blacklist.tenantId, tenantId));
  for (const r of rows) {
    const b = normalize(r.telnum);
    if (!b) continue;
    if (target === b || target.startsWith(b)) return true;
  }
  return false;
}

// Throwable guard for call paths.
export async function assertNotBlacklisted(tenantId: string, to: string) {
  if (await isBlacklisted(tenantId, to)) {
    const err: any = new Error('This number is on your block list.');
    err.statusCode = 403; err.data = { error: { code: 'blacklisted', message: 'This number is on your block list.' } };
    throw err;
  }
}
