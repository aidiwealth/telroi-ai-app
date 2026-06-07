import { and, eq } from 'drizzle-orm';
import { requirePlatformAdmin } from '~/server/utils/platform';
import { ensureSupportWorkspace } from '~/server/utils/support';
import { useDb, schema } from '~/server/db';
export default defineEventHandler(async (event) => {
  await requirePlatformAdmin(event);
  const ws = await ensureSupportWorkspace();
  const db = useDb();
  await db.delete(schema.aiAgents).where(and(eq(schema.aiAgents.id, getRouterParam(event, 'id')!), eq(schema.aiAgents.tenantId, ws.tenantId)));
  return { ok: true };
});
