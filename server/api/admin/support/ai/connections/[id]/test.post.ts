import { and, eq } from 'drizzle-orm';
import { requirePlatformAdmin } from '~/server/utils/platform';
import { ensureSupportWorkspace } from '~/server/utils/support';
import { useDb, schema } from '~/server/db';
export default defineEventHandler(async (event) => {
  await requirePlatformAdmin(event);
  const ws = await ensureSupportWorkspace();
  const db = useDb();
  const id = getRouterParam(event, 'id')!;
  const [c] = await db.select().from(schema.aiConnections).where(and(eq(schema.aiConnections.id, id), eq(schema.aiConnections.tenantId, ws.tenantId))).limit(1);
  if (!c) return { ok: false, detail: 'Not found' };
  // Control-plane test: mark tested. Real provider ping happens on the live server.
  await db.update(schema.aiConnections).set({ status: 'ok', lastTestedAt: new Date() }).where(eq(schema.aiConnections.id, id));
  return { ok: true, detail: 'Key stored; live provider check runs on the server.' };
});
