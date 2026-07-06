// Builds the knowledge-base context injected into an agent's system prompt so the
// AI answers from the client's uploaded company documents. "Simple" retrieval:
// concatenate the agent's ready+enabled docs up to a character budget (fits typical
// company docs — FAQs, services, policies — in the model's context). When data
// outgrows the budget we can switch to embed+vector RAG later without changing the
// call sites.
import { useDb, schema } from '~/server/db';
import { and, eq } from 'drizzle-orm';

// ~12k chars ≈ a few thousand tokens — plenty for typical business docs while
// leaving room for the persona, conversation history, and the reply.
const KB_CHAR_BUDGET = 12000;

export async function buildKnowledgeContext(agentId: string, tenantId: string): Promise<string> {
  const db = useDb();
  const docs = await db.select({
    fileName: schema.knowledgeDocuments.fileName,
    extractedText: schema.knowledgeDocuments.extractedText
  }).from(schema.knowledgeDocuments)
    .where(and(
      eq(schema.knowledgeDocuments.agentId, agentId),
      eq(schema.knowledgeDocuments.tenantId, tenantId),
      eq(schema.knowledgeDocuments.status, 'ready'),
      eq(schema.knowledgeDocuments.enabled, true)
    ));
  if (!docs.length) return '';

  let used = 0;
  const parts: string[] = [];
  for (const d of docs) {
    const text = (d.extractedText || '').trim();
    if (!text) continue;
    const remaining = KB_CHAR_BUDGET - used;
    if (remaining <= 0) break;
    const slice = text.length > remaining ? text.slice(0, remaining) : text;
    parts.push(`### ${d.fileName}\n${slice}`);
    used += slice.length;
  }
  if (!parts.length) return '';

  return `\n\n## Company knowledge base
Use the following information about this business to answer callers accurately. Treat it as the source of truth. If a caller asks something not covered here, say you're not certain and offer to connect them to a team member — do not guess.

${parts.join('\n\n')}`;
}
