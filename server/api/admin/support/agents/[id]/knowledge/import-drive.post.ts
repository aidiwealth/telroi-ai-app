// POST /api/admin/support/agents/:id/knowledge/import-drive — support-workspace Drive import.
import { requirePlatformAdmin } from '~/server/utils/platform';
import { ensureSupportWorkspace } from '~/server/utils/support';
import { apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
import { and, eq } from 'drizzle-orm';
import { toDirectDriveUrl } from '~/server/utils/crm-import';
import { detectFileType, extractText, normalizeText } from '~/server/utils/knowledge-extract';

const MAX_BYTES = 15 * 1024 * 1024;

export default defineEventHandler(async (event) => {
  await requirePlatformAdmin(event);
  const ws = await ensureSupportWorkspace();
  const agentId = getRouterParam(event, 'id');
  if (!agentId) throw apiError('invalid', 'agent id required', 400);
  const url = ((await readBody(event))?.url || '').trim();
  if (!url || !/drive\.google\.com|docs\.google\.com/.test(url)) throw apiError('invalid', 'Please paste a valid Google Drive share link.', 400);

  const db = useDb();
  const [agent] = await db.select().from(schema.aiAgents)
    .where(and(eq(schema.aiAgents.id, agentId), eq(schema.aiAgents.tenantId, ws.tenantId))).limit(1);
  if (!agent) throw apiError('not_found', 'agent not found', 404);

  let buffer: Buffer; let headerName = '';
  try {
    const res = await fetch(toDirectDriveUrl(url));
    if (!res.ok) throw new Error(`status ${res.status}`);
    const cd = res.headers.get('content-disposition') || '';
    const m = cd.match(/filename\*?=(?:UTF-8'')?["']?([^"';\n]+)/i);
    if (m) headerName = decodeURIComponent(m[1]).trim();
    const arr = await res.arrayBuffer();
    if (arr.byteLength > MAX_BYTES) throw apiError('invalid', 'File exceeds the 15MB limit', 400);
    buffer = Buffer.from(arr);
  } catch (e: any) {
    if (e?.statusCode) throw e;
    throw apiError('invalid', 'Could not fetch that Drive file. Make sure it is shared as "Anyone with the link can view".', 400);
  }

  const fileName = (headerName || 'Google Drive document').slice(0, 120);
  const fileType = detectFileType(fileName) || 'pdf';
  if (!['pdf', 'docx', 'txt', 'md'].includes(fileType)) throw apiError('invalid', 'Unsupported file type.', 400);

  const [doc] = await db.insert(schema.knowledgeDocuments).values({
    tenantId: ws.tenantId, agentId, fileName, fileType, sizeBytes: buffer.length, status: 'processing', sourceType: 'drive', sourceUrl: url
  }).returning();
  try {
    const text = normalizeText(await extractText(buffer, fileType as any));
    if (!text) { await db.update(schema.knowledgeDocuments).set({ status: 'failed', error: 'No readable text.', updatedAt: new Date() }).where(eq(schema.knowledgeDocuments.id, doc.id)); throw apiError('invalid', 'Could not read text from that Drive file.', 400); }
    await db.update(schema.knowledgeDocuments).set({ status: 'ready', extractedText: text, charCount: text.length, updatedAt: new Date() }).where(eq(schema.knowledgeDocuments.id, doc.id));
    return { id: doc.id, fileName, fileType, charCount: text.length, status: 'ready' };
  } catch (e: any) {
    if (e?.statusCode) throw e;
    await db.update(schema.knowledgeDocuments).set({ status: 'failed', error: (e?.message || 'failed').slice(0, 500), updatedAt: new Date() }).where(eq(schema.knowledgeDocuments.id, doc.id));
    throw apiError('server_error', 'Failed to process the Drive document.', 500);
  }
});
