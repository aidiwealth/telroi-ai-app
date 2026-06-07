// GET /api/live-call/sessions -> recent widget sessions (for map + list).
import { eq, desc } from 'drizzle-orm';
import { requireTenant } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  const db = useDb();
  const rows = await db.select().from(schema.liveCallSessions)
    .where(eq(schema.liveCallSessions.tenantId, s.tenantId))
    .orderBy(desc(schema.liveCallSessions.startedAt)).limit(500);
  return { sessions: rows };
});
