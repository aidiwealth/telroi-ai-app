// GET /api/live-call/routing-options -> teams + AI agents to populate Live Call
// routing selectors (so calls can be handled by a team or an AI agent).
import { eq } from 'drizzle-orm';
import { requireTenant } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  const db = useDb();
  const teams = await db.select({ id: schema.departments.id, name: schema.departments.name })
    .from(schema.departments).where(eq(schema.departments.tenantId, s.tenantId));
  const agents = await db.select({ id: schema.aiAgents.id, name: schema.aiAgents.name })
    .from(schema.aiAgents).where(eq(schema.aiAgents.tenantId, s.tenantId));
  return { teams, agents };
});
