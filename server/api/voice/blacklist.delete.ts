// DELETE /api/voice/blacklist?telnum=... -> unblock (local + PBX mirror).
import { and, eq } from 'drizzle-orm';
import { requireTenant, apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
import { telroiFor } from '~/server/utils/tenant';
export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  const telnum = getQuery(event).telnum as string;
  if (!telnum) throw apiError('invalid', 'telnum required');
  const db = useDb();
  await db.delete(schema.blacklist)
    .where(and(eq(schema.blacklist.tenantId, s.tenantId), eq(schema.blacklist.telnum, telnum)));
  try { const client = await telroiFor(s.tenantId); await client.deleteBlacklist([telnum]); } catch { /* */ }
  return { ok: true };
});
