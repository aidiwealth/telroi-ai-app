// GET /api/copilot/conversations — list the user's saved copilot chats (titles only).
import { requireTenant } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
import { and, eq, desc } from 'drizzle-orm';

export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  const db = useDb();
  return await db.select({ id: schema.copilotConversations.id, title: schema.copilotConversations.title, updatedAt: schema.copilotConversations.updatedAt })
    .from(schema.copilotConversations)
    .where(and(eq(schema.copilotConversations.tenantId, s.tenantId), eq(schema.copilotConversations.userId, s.userId)))
    .orderBy(desc(schema.copilotConversations.updatedAt)).limit(30);
});
