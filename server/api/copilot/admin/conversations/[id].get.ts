// GET /api/copilot/admin/conversations/:id — load one admin chat (own only).
import { requireSuperAdmin } from '~/server/utils/platform';
import { apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
import { and, eq } from 'drizzle-orm';

export default defineEventHandler(async (event) => {
  const admin = await requireSuperAdmin(event);
  const id = getRouterParam(event, 'id');
  const db = useDb();
  const [c] = await db.select().from(schema.adminCopilotConversations)
    .where(and(eq(schema.adminCopilotConversations.id, id), eq(schema.adminCopilotConversations.adminEmail, admin.email))).limit(1);
  if (!c) throw apiError('not_found', 'Conversation not found', 404);
  return { id: c.id, messages: c.messages };
});
