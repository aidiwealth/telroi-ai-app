// POST /api/agents/:id/knowledge/upload  (multipart: file)
// Uploads a training document for an agent: stores the original in R2, extracts
// plain text (PDF/Word/txt/md), and records it in knowledge_documents.
import { requireTenant, apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
import { and, eq } from 'drizzle-orm';
import { putObject, buildKey } from '~/server/utils/storage';
import { detectFileType, extractText, normalizeText } from '~/server/utils/knowledge-extract';

const MAX_BYTES = 15 * 1024 * 1024;

export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  const agentId = getRouterParam(event, 'id');
  if (!agentId) throw apiError('invalid', 'agent id required', 400);

  const db = useDb();
  const [agent] = await db.select().from(schema.aiAgents)
    .where(and(eq(schema.aiAgents.id, agentId), eq(schema.aiAgents.tenantId, s.tenantId))).limit(1);
  if (!agent) throw apiError('not_found', 'agent not found', 404);

  const form = await readMultipartFormData(event);
  const file = form?.find((f) => f.name === 'file');
  if (!file?.data) throw apiError('invalid', 'No file uploaded', 400);
  if (file.data.length > MAX_BYTES) throw apiError('invalid', 'File exceeds the 15MB limit', 400);

  const fileName = file.filename || 'document';
  const fileType = detectFileType(fileName, file.type);
  if (!fileType) throw apiError('invalid', 'Unsupported file type. Upload a PDF, Word (.docx), text, or markdown file.', 400);

  const key = buildKey('knowledge', s.tenantId, fileName);
  await putObject(key, file.data as Buffer, file.type || 'application/octet-stream');

  const [doc] = await db.insert(schema.knowledgeDocuments).values({
    tenantId: s.tenantId, agentId, createdByUserId: s.userId,
    fileName, fileKey: key, fileType, sizeBytes: file.data.length, status: 'processing'
  }).returning();

  try {
    const raw = await extractText(file.data as Buffer, fileType);
    const text = normalizeText(raw);
    if (!text) {
      await db.update(schema.knowledgeDocuments)
        .set({ status: 'failed', error: 'No readable text found in the document.', updatedAt: new Date() })
        .where(eq(schema.knowledgeDocuments.id, doc.id));
      throw apiError('invalid', 'We could not read any text from that file. If it is a scanned PDF, it may need OCR.', 400);
    }
    await db.update(schema.knowledgeDocuments)
      .set({ status: 'ready', extractedText: text, charCount: text.length, updatedAt: new Date() })
      .where(eq(schema.knowledgeDocuments.id, doc.id));
    return { id: doc.id, fileName, fileType, charCount: text.length, status: 'ready' };
  } catch (e: any) {
    if (e?.statusCode) throw e;
    await db.update(schema.knowledgeDocuments)
      .set({ status: 'failed', error: (e?.message || 'extraction failed').slice(0, 500), updatedAt: new Date() })
      .where(eq(schema.knowledgeDocuments.id, doc.id));
    throw apiError('server_error', 'Failed to process the document. Please try a different file.', 500);
  }
});
