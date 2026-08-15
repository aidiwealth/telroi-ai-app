// GET /api/admin/support/subscriptions -> our own numbers and how they behave.
//
// The support desk's numbers have never been editable from the interface: their
// routing, escalation and recording were all set at a database prompt, which is
// a poor way to run a support line and worse when something needs changing in a
// hurry.
import { eq, desc } from 'drizzle-orm';
import { requirePlatformAdmin } from '~/server/utils/platform';
import { ensureSupportWorkspace } from '~/server/utils/support';
import { useDb, schema } from '~/server/db';

export default defineEventHandler(async (event) => {
  await requirePlatformAdmin(event);
  const ws = await ensureSupportWorkspace();
  const db = useDb();

  const rows = await db.select().from(schema.numberSubscriptions)
    .where(eq(schema.numberSubscriptions.tenantId, ws.tenantId))
    .orderBy(desc(schema.numberSubscriptions.purchasedAt));

  const agents = await db.select({ id: schema.aiAgents.id, name: schema.aiAgents.name })
    .from(schema.aiAgents).where(eq(schema.aiAgents.tenantId, ws.tenantId));

  const depts = await db.select({ id: schema.departments.id, name: schema.departments.name })
    .from(schema.departments).where(eq(schema.departments.tenantId, ws.tenantId));

  return {
    numbers: rows.map((r) => ({
      id: r.id, telnum: r.telnum, provider: r.provider, region: r.region, status: r.status,
      routeType: r.routeType, routeAgentId: r.routeAgentId, departmentId: r.departmentId,
      routeTarget: r.routeTarget,
      escalateMode: r.routeEscalateMode, escalateTo: r.routeEscalateTo, escalateAfter: r.routeEscalateAfter,
      recordCalls: r.recordCalls
    })),
    agents, departments: depts
  };
});
