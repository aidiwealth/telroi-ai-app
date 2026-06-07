// GET /api/admin/support/sessions -> support workspace Live Call sessions + contacts.
import { eq, desc } from 'drizzle-orm';
import { requirePlatformAdmin } from '~/server/utils/platform';
import { ensureSupportWorkspace } from '~/server/utils/support';
import { useDb, schema } from '~/server/db';
export default defineEventHandler(async (event) => {
  await requirePlatformAdmin(event);
  const ws = await ensureSupportWorkspace();
  const db = useDb();
  const sessions = await db.select().from(schema.liveCallSessions)
    .where(eq(schema.liveCallSessions.tenantId, ws.tenantId))
    .orderBy(desc(schema.liveCallSessions.startedAt)).limit(200);
  const contacts = await db.select().from(schema.crmContacts)
    .where(eq(schema.crmContacts.tenantId, ws.tenantId))
    .orderBy(desc(schema.crmContacts.updatedAt)).limit(200);
  return { sessions, contacts };
});
