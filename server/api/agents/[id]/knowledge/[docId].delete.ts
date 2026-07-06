// DELETE /api/agents/:id/knowledge/:docId -> remove a document + its R2 object.
import { requireTenant, apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
import { and, eq } from 'drizzle-orm';
import { deleteObject } from '~/server/utils/storage';

export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  const agentId = getRouterParam(event, 'id');
  const docId = getRouterParam(event, 'docId');
  if (!agentId || !docId) throw apiError('invalid', 'ids required', 400);
  const db = useDb();
  const [doc] = await db.select().from(schema.knowledgeDocuments)
    .where(and(eq(schema.knowledgeDocuments.id, docId), eq(schema.knowledgeDocuments.tenantId, s.tenantId), eq(schema.knowledgeDocuments.agentId, agentId))).limit(1);
  if (!doc) throw apiError('not_found', 'document not found', 404);
  if (doc.fileKey) { try { await deleteObject(doc.fileKey); } catch { /* best effort */ } }
  await db.delete(schema.knowledgeDocuments).where(eq(schema.knowledgeDocuments.id, docId));
  return { ok: true };
});
