// GET /api/admin/support/agents/:id/knowledge — list support-workspace agent docs.
import { requirePlatformAdmin } from '~/server/utils/platform';
import { ensureSupportWorkspace } from '~/server/utils/support';
import { apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
import { and, eq, desc } from 'drizzle-orm';

export default defineEventHandler(async (event) => {
  await requirePlatformAdmin(event);
  const ws = await ensureSupportWorkspace();
  const agentId = getRouterParam(event, 'id');
  if (!agentId) throw apiError('invalid', 'agent id required', 400);
  const db = useDb();
  return await db.select({
    id: schema.knowledgeDocuments.id, fileName: schema.knowledgeDocuments.fileName,
    fileType: schema.knowledgeDocuments.fileType, sizeBytes: schema.knowledgeDocuments.sizeBytes,
    status: schema.knowledgeDocuments.status, charCount: schema.knowledgeDocuments.charCount,
    enabled: schema.knowledgeDocuments.enabled, error: schema.knowledgeDocuments.error,
    createdAt: schema.knowledgeDocuments.createdAt
  }).from(schema.knowledgeDocuments)
    .where(and(eq(schema.knowledgeDocuments.agentId, agentId), eq(schema.knowledgeDocuments.tenantId, ws.tenantId)))
    .orderBy(desc(schema.knowledgeDocuments.createdAt));
});
