// GET /v1/agents/:id/knowledge — list the knowledge documents an AI agent is
// trained on (read-only). Scope: agents:read. Returns Stripe-style { object, data }.
import { requireApiKey, hasScope } from '~/server/utils/apikey-auth';
import { apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
import { and, eq, desc } from 'drizzle-orm';

export default defineEventHandler(async (event) => {
  const ctx = await requireApiKey(event);
  if (!hasScope(ctx, 'agents:read')) throw apiError('forbidden', 'Key lacks agents:read', 403);
  const agentId = getRouterParam(event, 'id');
  if (!agentId) throw apiError('invalid', 'agent id required', 400);

  const db = useDb();
  const [agent] = await db.select({ id: schema.aiAgents.id }).from(schema.aiAgents)
    .where(and(eq(schema.aiAgents.id, agentId), eq(schema.aiAgents.tenantId, ctx.tenantId))).limit(1);
  if (!agent) throw apiError('not_found', 'agent not found', 404);

  const docs = await db.select({
    id: schema.knowledgeDocuments.id, file_name: schema.knowledgeDocuments.fileName,
    file_type: schema.knowledgeDocuments.fileType, source_type: schema.knowledgeDocuments.sourceType,
    status: schema.knowledgeDocuments.status, char_count: schema.knowledgeDocuments.charCount,
    enabled: schema.knowledgeDocuments.enabled, created_at: schema.knowledgeDocuments.createdAt
  }).from(schema.knowledgeDocuments)
    .where(and(eq(schema.knowledgeDocuments.agentId, agentId), eq(schema.knowledgeDocuments.tenantId, ctx.tenantId)))
    .orderBy(desc(schema.knowledgeDocuments.createdAt));

  return {
    object: 'list',
    data: docs.map((d) => ({ object: 'knowledge_document', ...d }))
  };
});
