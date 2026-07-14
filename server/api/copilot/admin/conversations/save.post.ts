// POST /api/copilot/admin/conversations/save { id?, messages } — create/update an
// admin copilot chat, scoped by the signed-in admin's email.
import { requireSuperAdmin } from '~/server/utils/platform';
import { apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
import { and, eq } from 'drizzle-orm';

export default defineEventHandler(async (event) => {
  const admin = await requireSuperAdmin(event);
  const body = await readBody(event);
  const messages = Array.isArray(body?.messages)
    ? body.messages.filter((m) => m && typeof m.content === 'string' && (m.role === 'user' || m.role === 'assistant')).map((m) => ({ role: m.role, content: m.content }))
    : [];
  if (!messages.length) throw apiError('invalid', 'no messages', 400);
  const firstUser = messages.find((m) => m.role === 'user');
  const title = (firstUser?.content || 'New conversation').slice(0, 60);
  const db = useDb();

  if (body?.id) {
    const [c] = await db.select({ id: schema.adminCopilotConversations.id }).from(schema.adminCopilotConversations)
      .where(and(eq(schema.adminCopilotConversations.id, body.id), eq(schema.adminCopilotConversations.adminEmail, admin.email))).limit(1);
    if (c) {
      await db.update(schema.adminCopilotConversations).set({ messages, title, updatedAt: new Date() }).where(eq(schema.adminCopilotConversations.id, body.id));
      return { id: body.id };
    }
  }
  const [row] = await db.insert(schema.adminCopilotConversations).values({ adminEmail: admin.email, title, messages }).returning();
  return { id: row.id };
});
