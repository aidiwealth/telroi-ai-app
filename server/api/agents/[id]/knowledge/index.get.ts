// GET /api/agents/:id/knowledge -> the agent's knowledge documents (no heavy text).
import { requireTenant, apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
import { and, eq, desc } from 'drizzle-orm';

export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  const agentId = getRouterParam(event, 'id');
  if (!agentId) throw apiError('invalid', 'agent id required', 400);
  const db = useDb();
  const rows = await db.select({
    id: schema.knowledgeDocuments.id,
    fileName: schema.knowledgeDocuments.fileName,
    fileType: schema.knowledgeDocuments.fileType,
    sizeBytes: schema.knowledgeDocuments.sizeBytes,
    status: schema.knowledgeDocuments.status,
    charCount: schema.knowledgeDocuments.charCount,
    enabled: schema.knowledgeDocuments.enabled,
    error: schema.knowledgeDocuments.error,
    createdAt: schema.knowledgeDocuments.createdAt
  }).from(schema.knowledgeDocuments)
    .where(and(eq(schema.knowledgeDocuments.agentId, agentId), eq(schema.knowledgeDocuments.tenantId, s.tenantId)))
    .orderBy(desc(schema.knowledgeDocuments.createdAt));
  return rows;
});
