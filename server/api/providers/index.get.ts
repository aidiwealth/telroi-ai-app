// GET /api/providers -> connected carriers (masked, no creds returned)
import { eq } from 'drizzle-orm';
import { requireTenant } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  const db = useDb();
  const rows = await db.select().from(schema.voiceProviders).where(eq(schema.voiceProviders.tenantId, s.tenantId));
  return rows.map((r) => ({ id: r.id, kind: r.kind, isDefault: r.isDefault, status: r.status, createdAt: r.createdAt }));
});
