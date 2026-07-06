// GET /api/copilot/conversations/:id — load one saved chat's messages.
import { requireTenant, apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
import { and, eq } from 'drizzle-orm';

export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  const id = getRouterParam(event, 'id');
  if (!id) throw apiError('invalid', 'id required', 400);
  const db = useDb();
  const [c] = await db.select().from(schema.copilotConversations)
    .where(and(eq(schema.copilotConversations.id, id), eq(schema.copilotConversations.tenantId, s.tenantId), eq(schema.copilotConversations.userId, s.userId))).limit(1);
  if (!c) throw apiError('not_found', 'not found', 404);
  return { id: c.id, title: c.title, messages: c.messages };
});
