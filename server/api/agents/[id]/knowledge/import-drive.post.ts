// POST /api/agents/:id/knowledge/import-drive  { url }
// Imports a Google Drive document (shared by link) as agent knowledge: fetches the
// file, extracts text, and stores it. Reuses the same extraction + record pipeline
// as uploads. The original file is fetched from Drive (not re-stored in R2) — we
// keep the sourceUrl so it can be refreshed later.
import { requireTenant, apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
import { and, eq } from 'drizzle-orm';
import { toDirectDriveUrl } from '~/server/utils/crm-import';
import { detectFileType, extractText, normalizeText } from '~/server/utils/knowledge-extract';

const MAX_BYTES = 15 * 1024 * 1024;

export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  const agentId = getRouterParam(event, 'id');
  if (!agentId) throw apiError('invalid', 'agent id required', 400);
  const body = await readBody(event);
  const url = (body?.url || '').trim();
  if (!url || !/drive\.google\.com|docs\.google\.com/.test(url)) {
    throw apiError('invalid', 'Please paste a valid Google Drive share link.', 400);
  }

  const db = useDb();
  const [agent] = await db.select().from(schema.aiAgents)
    .where(and(eq(schema.aiAgents.id, agentId), eq(schema.aiAgents.tenantId, s.tenantId))).limit(1);
  if (!agent) throw apiError('not_found', 'agent not found', 404);

  // Fetch the file from Drive.
  const directUrl = toDirectDriveUrl(url);
  let buffer: Buffer;
  try {
    const res = await fetch(directUrl);
    if (!res.ok) throw new Error(`status ${res.status}`);
    const arr = await res.arrayBuffer();
    if (arr.byteLength > MAX_BYTES) throw apiError('invalid', 'File exceeds the 15MB limit', 400);
    buffer = Buffer.from(arr);
  } catch (e: any) {
    if (e?.statusCode) throw e;
    throw apiError('invalid', 'Could not fetch that Drive file. Make sure the link is shared as "Anyone with the link can view".', 400);
  }

  // Derive a filename + type. Drive direct downloads don't always give a clean name,
  // so fall back to the link and let detection use content where possible.
  const guessName = (url.match(/\/d\/[^/]+\/?([^?]+)?/)?.[0] || 'drive-document');
  const fileName = decodeURIComponent((guessName.split('/').pop() || 'drive-document')).slice(0, 120) || 'drive-document';
  const fileType = detectFileType(fileName) || 'pdf'; // Drive docs are commonly PDF exports
  if (!['pdf', 'docx', 'txt', 'md'].includes(fileType)) {
    throw apiError('invalid', 'Unsupported file type. Share a PDF, Word, or text document.', 400);
  }

  const [doc] = await db.insert(schema.knowledgeDocuments).values({
    tenantId: s.tenantId, agentId, createdByUserId: s.userId,
    fileName, fileType, sizeBytes: buffer.length, status: 'processing',
    sourceType: 'drive', sourceUrl: url
  }).returning();

  try {
    const raw = await extractText(buffer, fileType as any);
    const text = normalizeText(raw);
    if (!text) {
      await db.update(schema.knowledgeDocuments)
        .set({ status: 'failed', error: 'No readable text found. If it is a scanned PDF, it needs OCR.', updatedAt: new Date() })
        .where(eq(schema.knowledgeDocuments.id, doc.id));
      throw apiError('invalid', 'We could not read any text from that Drive file.', 400);
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
    throw apiError('server_error', 'Failed to process the Drive document.', 500);
  }
});
