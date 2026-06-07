import { eq } from 'drizzle-orm';
import { requirePlatformAdmin } from '~/server/utils/platform';
import { ensureSupportWorkspace } from '~/server/utils/support';
import { useDb, schema } from '~/server/db';
export default defineEventHandler(async (event) => {
  await requirePlatformAdmin(event);
  const ws = await ensureSupportWorkspace();
  const db = useDb();
  const rows = await db.select().from(schema.aiConnections).where(eq(schema.aiConnections.tenantId, ws.tenantId));
  return rows.map((r) => ({ id: r.id, provider: r.provider, keyMasked: `••••••${r.keyLast4}`, status: r.status, lastTestedAt: r.lastTestedAt, meta: r.meta }));
});
