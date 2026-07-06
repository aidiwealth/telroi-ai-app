// POST /api/copilot/chat — the account copilot (Tier 1: read / analyze / guide).
// Cheap by design: one managed LLM call (Haiku/4o-mini), a tight system prompt, and
// a small read-only context snapshot. It answers questions and points the user to the
// right page with a deep-link. Write/spend actions are handled in later tiers.
import { requireTenant, apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
import { and, eq, gte, sql } from 'drizzle-orm';
import { resolveAgentLlm, llmReply, type ChatMessage } from '~/server/utils/voice/ai-brain';

// A compact map of where things live, so the copilot can deep-link accurately.
const NAV = `Pages the user can be sent to (use these exact paths in links):
- /numbers — phone numbers, routing, escalation
- /teams — departments and members
- /blacklist — blocked numbers
- /connect — AI agents, connections, knowledge base, VANs
- /calls — call history and recordings
- /settings — plan, billing, workspace, webhooks, members, compliance
- /apps — integrations (HubSpot, Zoho, etc.)`;

function sysPrompt(ctx: string): string {
  return [
    'You are Telroi Copilot, the in-app assistant for a voice-AI platform.',
    'You help clients understand and run their account: setting up SIP, AI agents, knowledge bases, numbers, VANs (Virtual AI Numbers), call analysis, and features.',
    'Be concise and practical. Prefer 1-3 short sentences. When a task belongs on a specific page, tell the user briefly and include a deep-link.',
    'You cannot yet perform actions (create/buy/provision) directly — for those, explain the steps and link the page. Never claim you did something you did not do.',
    'If asked something outside the Telroi product, gently redirect.',
    '',
    NAV,
    '',
    'Current account snapshot (for grounding answers):',
    ctx,
    '',
    'When you want to point the user to a page, end your reply with a line exactly like: LINKS: /numbers | /calls  (pipe-separated paths, only from the list above). Omit the LINKS line if none apply.'
  ].join('\n');
}

export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  const body = await readBody(event);
  const message = (body?.message || '').toString().trim();
  if (!message) throw apiError('invalid', 'message required', 400);
  const history: ChatMessage[] = Array.isArray(body?.history)
    ? body.history.filter((m: any) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string').slice(-6)
    : [];

  // Cheap read-only snapshot for grounding (kept tiny to control tokens).
  const db = useDb();
  let ctx = '';
  try {
    const since = new Date(Date.now() - 7 * 24 * 3600 * 1000);
    const [agentCount] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.aiAgents).where(eq(schema.aiAgents.tenantId, s.tenantId));
    const [vanCount] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.vans).where(eq(schema.vans.tenantId, s.tenantId)).catch(() => [{ n: 0 }] as any);
    ctx = `- AI agents: ${agentCount?.n ?? 0}\n- Virtual AI Numbers: ${vanCount?.n ?? 0}\n- Window: last 7 days`;
  } catch { ctx = '(snapshot unavailable)'; }

  // Cheap managed model (Haiku / gpt-4o-mini). Copilot is orchestration, not deep reasoning.
  const llm = await resolveAgentLlm(s.tenantId, null, true);
  if (!llm) throw apiError('unavailable', 'Copilot is not configured', 503);

  const raw = (await llmReply(llm, sysPrompt(ctx), [...history, { role: 'user', content: message }])) || '';

  // Parse an optional trailing "LINKS: /a | /b" line into structured deep-links.
  const allowed = ['/numbers', '/teams', '/blacklist', '/connect', '/calls', '/settings', '/apps'];
  let reply = raw; let links: Array<{ label: string; to: string }> = [];
  const m = raw.match(/\n?LINKS:\s*(.+)\s*$/i);
  if (m) {
    reply = raw.slice(0, m.index).trim();
    links = m[1].split('|').map((p) => p.trim()).filter((p) => allowed.includes(p))
      .map((to) => ({ to, label: to.replace('/', '').replace(/^\w/, (c) => c.toUpperCase()) || 'Open' }));
  }
  return { reply, links };
});
