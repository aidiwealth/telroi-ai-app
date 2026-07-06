// POST /api/agents/:id/knowledge/import-url  { url }
// Scrapes a public web page and stores its readable text as agent knowledge.
import { requireTenant, apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
import { and, eq } from 'drizzle-orm';
import { extractHtmlText, normalizeText } from '~/server/utils/knowledge-extract';

const MAX_BYTES = 5 * 1024 * 1024; // 5MB of HTML is plenty

export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  const agentId = getRouterParam(event, 'id');
  if (!agentId) throw apiError('invalid', 'agent id required', 400);
  const body = await readBody(event);
  let url = (body?.url || '').trim();
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  try { new URL(url); } catch { throw apiError('invalid', 'Please enter a valid web page URL.', 400); }

  const db = useDb();
  const [agent] = await db.select().from(schema.aiAgents)
    .where(and(eq(schema.aiAgents.id, agentId), eq(schema.aiAgents.tenantId, s.tenantId))).limit(1);
  if (!agent) throw apiError('not_found', 'agent not found', 404);

  // Fetch the page.
  let html = '';
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'TelroiBot/1.0 (+https://telroi.ai)' }, redirect: 'follow' });
    if (!res.ok) throw new Error(`status ${res.status}`);
    const ct = res.headers.get('content-type') || '';
    if (!/text\/html|application\/xhtml/i.test(ct)) {
      throw apiError('invalid', 'That URL is not a web page. For files, use the upload or Drive import instead.', 400);
    }
    const arr = await res.arrayBuffer();
    if (arr.byteLength > MAX_BYTES) throw apiError('invalid', 'That page is too large to import.', 400);
    html = Buffer.from(arr).toString('utf-8');
  } catch (e: any) {
    if (e?.statusCode) throw e;
    throw apiError('invalid', 'Could not fetch that page. Check the URL is public and reachable.', 400);
  }

  const host = (() => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return 'web page'; } })();
  const [doc] = await db.insert(schema.knowledgeDocuments).values({
    tenantId: s.tenantId, agentId, createdByUserId: s.userId,
    fileName: host, fileType: 'url', sizeBytes: html.length, status: 'processing',
    sourceType: 'url', sourceUrl: url
  }).returning();

  try {
    const raw = await extractHtmlText(html);
    const text = normalizeText(raw);
    if (!text || text.length < 20) {
      await db.update(schema.knowledgeDocuments)
        .set({ status: 'failed', error: 'No readable text found on that page.', updatedAt: new Date() })
        .where(eq(schema.knowledgeDocuments.id, doc.id));
      throw apiError('invalid', 'We could not read meaningful text from that page.', 400);
    }
    await db.update(schema.knowledgeDocuments)
      .set({ status: 'ready', extractedText: text, charCount: text.length, updatedAt: new Date() })
      .where(eq(schema.knowledgeDocuments.id, doc.id));
    return { id: doc.id, fileName: host, fileType: 'url', charCount: text.length, status: 'ready' };
  } catch (e: any) {
    if (e?.statusCode) throw e;
    await db.update(schema.knowledgeDocuments)
      .set({ status: 'failed', error: (e?.message || 'extraction failed').slice(0, 500), updatedAt: new Date() })
      .where(eq(schema.knowledgeDocuments.id, doc.id));
    throw apiError('server_error', 'Failed to process that page.', 500);
  }
});
