// GET /api/admin/support/console -> Live Call sessions + CRM contacts for the
// Telroi Support workspace, so staff can attend to client support.
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
    .orderBy(desc(schema.liveCallSessions.startedAt)).limit(100);
  const contacts = await db.select().from(schema.crmContacts)
    .where(eq(schema.crmContacts.tenantId, ws.tenantId))
    .orderBy(desc(schema.crmContacts.updatedAt)).limit(100);
  const widgetKey = (await db.select({ k: schema.tenants.widgetKey }).from(schema.tenants).where(eq(schema.tenants.id, ws.tenantId)).limit(1))[0]?.k || null;
  return { supportTenantId: ws.tenantId, widgetKey, sessions, contacts };
});
