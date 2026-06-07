// GET /api/admin/status -> predetermined components with their LIVE derived
// status + uptime (read-only) plus the admin-editable bits (description, sort
// order, manual override), and the incident list. Admin cannot add/rename.
import { desc } from 'drizzle-orm';
import { requirePlatformAdmin } from '~/server/utils/platform';
import { useDb, schema } from '~/server/db';
import { computeStatus } from '~/server/utils/status-compute';
export default defineEventHandler(async (event) => {
  await requirePlatformAdmin(event);
  const { components } = await computeStatus();
  const incidents = await useDb().select().from(schema.statusIncidents)
    .orderBy(desc(schema.statusIncidents.startedAt)).limit(50);
  return { components, incidents };
});
