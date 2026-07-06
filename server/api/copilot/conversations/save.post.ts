// POST /api/copilot/conversations/save { id?, messages } — create or update a chat.
// Title is derived from the first user message. Returns the conversation id.
import { requireTenant, apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
import { and, eq } from 'drizzle-orm';

export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  const body = await readBody(event);
  const messages = Array.isArray(body?.messages) ? body.messages.filter((m: any) => m && typeof m.content === 'string' && (m.role === 'user' || m.role === 'assistant')).map((m: any) => ({ role: m.role, content: m.content })) : [];
  if (!messages.length) throw apiError('invalid', 'no messages', 400);
  const firstUser = messages.find((m: any) => m.role === 'user');
  const title = (firstUser?.content || 'New conversation').slice(0, 60);
  const db = useDb();

  if (body?.id) {
    const [c] = await db.select({ id: schema.copilotConversations.id }).from(schema.copilotConversations)
      .where(and(eq(schema.copilotConversations.id, body.id), eq(schema.copilotConversations.userId, s.userId))).limit(1);
    if (c) {
      await db.update(schema.copilotConversations).set({ messages, title, updatedAt: new Date() }).where(eq(schema.copilotConversations.id, body.id));
      return { id: body.id };
    }
  }
  const [row] = await db.insert(schema.copilotConversations).values({ tenantId: s.tenantId, userId: s.userId, title, messages }).returning();
  return { id: row.id };
});
