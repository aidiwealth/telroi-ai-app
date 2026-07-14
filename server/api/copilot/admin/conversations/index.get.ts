// GET /api/copilot/admin/conversations — recent admin copilot chats for this admin.
import { requireSuperAdmin } from '~/server/utils/platform';
import { useDb, schema } from '~/server/db';
import { desc, eq } from 'drizzle-orm';

export default defineEventHandler(async (event) => {
  const admin = await requireSuperAdmin(event);
  const db = useDb();
  return await db.select({ id: schema.adminCopilotConversations.id, title: schema.adminCopilotConversations.title, updatedAt: schema.adminCopilotConversations.updatedAt })
    .from(schema.adminCopilotConversations)
    .where(eq(schema.adminCopilotConversations.adminEmail, admin.email))
    .orderBy(desc(schema.adminCopilotConversations.updatedAt))
    .limit(30);
});
