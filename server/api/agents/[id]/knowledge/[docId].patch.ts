// PATCH /api/agents/:id/knowledge/:docId  { enabled }  -> toggle a doc on/off.
// A disabled doc stays stored but is not injected into the agent's answers.
import { requireTenant, apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
import { and, eq } from 'drizzle-orm';

export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  const agentId = getRouterParam(event, 'id');
  const docId = getRouterParam(event, 'docId');
  if (!agentId || !docId) throw apiError('invalid', 'ids required', 400);
  const body = await readBody(event);
  const enabled = !!body?.enabled;
  const db = useDb();
  const [doc] = await db.select().from(schema.knowledgeDocuments)
    .where(and(eq(schema.knowledgeDocuments.id, docId), eq(schema.knowledgeDocuments.tenantId, s.tenantId), eq(schema.knowledgeDocuments.agentId, agentId))).limit(1);
  if (!doc) throw apiError('not_found', 'document not found', 404);
  await db.update(schema.knowledgeDocuments)
    .set({ enabled, updatedAt: new Date() })
    .where(eq(schema.knowledgeDocuments.id, docId));
  return { ok: true, enabled };
});
