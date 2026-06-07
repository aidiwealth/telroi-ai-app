// GET /api/status -> public status: components with LIVE status + 90-day uptime
// derived from recorded health checks (never typed), plus recent incidents.
import { desc } from 'drizzle-orm';
import { useDb, schema } from '~/server/db';
import { computeStatus } from '~/server/utils/status-compute';
export default defineEventHandler(async () => {
  try {
    const { components, overall } = await computeStatus();
    const incidents = await useDb().select().from(schema.statusIncidents)
      .orderBy(desc(schema.statusIncidents.startedAt)).limit(20);
    const activeIncident = incidents.find((i) => i.status !== 'resolved');
    return { overall, components, incidents, hasActiveIncident: !!activeIncident };
  } catch {
    return { overall: 'operational', components: [], incidents: [], hasActiveIncident: false };
  }
});
