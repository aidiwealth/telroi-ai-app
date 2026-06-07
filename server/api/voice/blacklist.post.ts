// POST /api/voice/blacklist { telnum, comment } -> block a number/range.
// Writes to the local (carrier-agnostic) blacklist so it's enforced on every
// outbound path, and mirrors to the PBX for Digidite-routed calls.
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { requireTenant, apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
import { telroiFor } from '~/server/utils/tenant';
const Body = z.object({ telnum: z.string().min(3), comment: z.string().optional() });
export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  const parsed = Body.safeParse(await readBody(event));
  if (!parsed.success) throw apiError('invalid', 'telnum required');
  const db = useDb();
  // Local (authoritative, carrier-agnostic) — upsert.
  const [existing] = await db.select().from(schema.blacklist)
    .where(and(eq(schema.blacklist.tenantId, s.tenantId), eq(schema.blacklist.telnum, parsed.data.telnum))).limit(1);
  if (!existing) {
    await db.insert(schema.blacklist).values({ tenantId: s.tenantId, telnum: parsed.data.telnum, comment: parsed.data.comment || null });
  } else if (parsed.data.comment !== undefined) {
    await db.update(schema.blacklist).set({ comment: parsed.data.comment }).where(eq(schema.blacklist.id, existing.id));
  }
  // Mirror to PBX (best-effort) for Digidite dialplan-level blocking.
  try { const client = await telroiFor(s.tenantId); await client.addBlacklist([parsed.data]); } catch { /* */ }
  return { ok: true };
});
