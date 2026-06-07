// GET /api/ai/connections -> masked list (never returns the key)
import { eq } from 'drizzle-orm';
import { requireTenant } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';

export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  const db = useDb();
  const rows = await db.select().from(schema.aiConnections).where(eq(schema.aiConnections.tenantId, s.tenantId));
  return rows.map((r) => ({
    id: r.id, provider: r.provider, keyMasked: `••••••${r.keyLast4}`,
    status: r.status, lastTestedAt: r.lastTestedAt, meta: r.meta
  }));
});
