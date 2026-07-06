// POST /api/admin/support/agents/:id/knowledge/upload — support-workspace mirror of
// the client knowledge upload, so the admin support account has the same KB feature.
import { requirePlatformAdmin } from '~/server/utils/platform';
import { ensureSupportWorkspace } from '~/server/utils/support';
import { apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
import { and, eq } from 'drizzle-orm';
import { putObject, buildKey } from '~/server/utils/storage';
import { detectFileType, extractText, normalizeText } from '~/server/utils/knowledge-extract';

const MAX_BYTES = 15 * 1024 * 1024;

export default defineEventHandler(async (event) => {
  await requirePlatformAdmin(event);
  const ws = await ensureSupportWorkspace();
  const agentId = getRouterParam(event, 'id');
  if (!agentId) throw apiError('invalid', 'agent id required', 400);
  const db = useDb();
  const [agent] = await db.select().from(schema.aiAgents)
    .where(and(eq(schema.aiAgents.id, agentId), eq(schema.aiAgents.tenantId, ws.tenantId))).limit(1);
  if (!agent) throw apiError('not_found', 'agent not found', 404);

  const form = await readMultipartFormData(event);
  const file = form?.find((f) => f.name === 'file');
  if (!file?.data) throw apiError('invalid', 'No file uploaded', 400);
  if (file.data.length > MAX_BYTES) throw apiError('invalid', 'File exceeds the 15MB limit', 400);

  const fileName = file.filename || 'document';
  const fileType = detectFileType(fileName, file.type);
  if (!fileType) throw apiError('invalid', 'Unsupported file type.', 400);

  const key = buildKey('knowledge', ws.tenantId, fileName);
  await putObject(key, file.data as Buffer, file.type || 'application/octet-stream');

  const [doc] = await db.insert(schema.knowledgeDocuments).values({
    tenantId: ws.tenantId, agentId, fileName, fileKey: key, fileType, sizeBytes: file.data.length, status: 'processing'
  }).returning();

  try {
    const text = normalizeText(await extractText(file.data as Buffer, fileType));
    if (!text) {
      await db.update(schema.knowledgeDocuments).set({ status: 'failed', error: 'No readable text found.', updatedAt: new Date() }).where(eq(schema.knowledgeDocuments.id, doc.id));
      throw apiError('invalid', 'Could not read text from that file.', 400);
    }
    await db.update(schema.knowledgeDocuments).set({ status: 'ready', extractedText: text, charCount: text.length, updatedAt: new Date() }).where(eq(schema.knowledgeDocuments.id, doc.id));
    return { id: doc.id, fileName, fileType, charCount: text.length, status: 'ready' };
  } catch (e: any) {
    if (e?.statusCode) throw e;
    await db.update(schema.knowledgeDocuments).set({ status: 'failed', error: (e?.message || 'extraction failed').slice(0, 500), updatedAt: new Date() }).where(eq(schema.knowledgeDocuments.id, doc.id));
    throw apiError('server_error', 'Failed to process the document.', 500);
  }
});
