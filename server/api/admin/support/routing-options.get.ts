import { eq } from 'drizzle-orm';
import { requirePlatformAdmin } from '~/server/utils/platform';
import { ensureSupportWorkspace } from '~/server/utils/support';
import { useDb, schema } from '~/server/db';
export default defineEventHandler(async (event) => {
  await requirePlatformAdmin(event);
  const ws = await ensureSupportWorkspace();
  const db = useDb();
  const teams = await db.select({ id: schema.departments.id, name: schema.departments.name }).from(schema.departments).where(eq(schema.departments.tenantId, ws.tenantId));
  const agents = await db.select({ id: schema.aiAgents.id, name: schema.aiAgents.name }).from(schema.aiAgents).where(eq(schema.aiAgents.tenantId, ws.tenantId));
  return { teams, agents };
});
