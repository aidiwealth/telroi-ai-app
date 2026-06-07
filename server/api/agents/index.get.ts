// GET /api/agents -> list AI agent configs
import { eq } from 'drizzle-orm';
import { requireTenant } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  const db = useDb();
  return await db.select().from(schema.aiAgents).where(eq(schema.aiAgents.tenantId, s.tenantId));
});
