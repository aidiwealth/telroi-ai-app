// POST /api/copilot/chat — the account copilot (Tier 1: read / analyze / guide).
// Cheap by design: one managed LLM call (Haiku/4o-mini), a tight system prompt, and
// a small read-only context snapshot. It answers questions and points the user to the
// right page with a deep-link. Write/spend actions are handled in later tiers.
import { requireTenant, apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
import { and, eq, gte, sql } from 'drizzle-orm';
import { resolveAgentLlm, llmReply, type ChatMessage } from '~/server/utils/voice/ai-brain';

// A compact map of where things live, so the copilot can deep-link accurately.
const NAV = `Accurate page map — use these EXACT paths and never invent one:
- /wallet — WALLET: balance, fund/top up, payments, transactions (payments live HERE, not in settings)
- /calls — call history, recordings, analytics
- /numbers — phone numbers: buy/manage numbers, routing, escalation
- /connect — AI agents: create/edit agents, greeting, system prompt, KNOWLEDGE BASE (upload docs, Drive/URL import), language
- /vans — AI Numbers (Virtual AI Numbers): bind an agent to a number
- /ai — AI Connections: STT/LLM/TTS provider connections (OpenAI, Anthropic, Deepgram, Google)
- /sip — SIP endpoints: provision/manage SIP accounts and softphones
- /optimize — AI optimization settings
- /blacklist — blocked numbers
- /people — team members
- /teams — departments/teams
- /crm — contacts / CRM
- /live-call — live call console
- /apps — integrations (HubSpot, Zoho, etc.)
- /settings — plan tier, workspace name/timezone, webhooks, members, compliance (NOT payments — those are in /wallet)`;

function sysPrompt(ctx: string): string {
  return [
    'You are Telroi Copilot, the in-app assistant for a voice-AI platform.',
    'You help clients understand and run their account: setting up SIP, AI agents, knowledge bases, numbers, VANs (Virtual AI Numbers), call analysis, and features.',
    'Be concise and practical. Prefer 1-3 short sentences. When a task belongs on a specific page, tell the user briefly and include a deep-link.',
    'You can perform a small set of safe actions on the user\'s behalf. When the user clearly wants one, PROPOSE it (do not claim it is done). To propose, end your reply with a single line: ACTION: {"type":"...","args":{...}} using ONLY these types:',
    '  - create_van {name, telnum, agentId?} — create a Virtual AI Number on an owned number',
    '  - add_blacklist {telnum, comment?} — block a number',
    '  - create_department {name, description?} — add a department',
    '  - set_agent_language {agentId, language} — language is a BCP-47 code (en-NG, yo-NG, ig-NG, ha-NG, fr-FR, ...)',
    '  - knowledge_url {agentId, url} — add a web page to an agent\'s knowledge base',
    '  - knowledge_drive {agentId, url} — add a Google Drive file to an agent\'s knowledge',
    '  - toggle_feature {feature, enabled} — enable/disable a feature',
    '  - buy_number {inventoryId, channels?} — PURCHASE a phone number. This SPENDS money from the wallet. Only propose a specific inventoryId from the Available numbers list above, and only after the user has clearly chosen one. If they only say buy a number without picking, first LIST the available numbers with their price and ask which one; do NOT propose buy_number yet.',
    'Use the exact agent id from the snapshot for agentId. If a required detail is missing (which number, which agent), ASK instead of proposing. Only ONE action per reply. For anything not in this list (buying numbers, provisioning SIP, payments), explain and link the page — do not propose. Keep your normal reply text above the ACTION line short.',
    'Be accurate about where things live: payments/funding are on the Wallet page (/wallet), NOT settings. Knowledge base is on /connect inside an agent. If you are not certain which page or how something works, say so plainly and suggest the closest page rather than guessing or inventing steps.',
    'You are strictly a Telroi account assistant. If asked anything unrelated to Telroi or running this account (general knowledge, trivia, world facts, capitals, people, math, coding, opinions, etc.), do NOT answer it \u2014 not even partially, not even as an aside. Never state the fact and then redirect. Instead reply only with a brief redirect, e.g. \"I can only help with your Telroi account \u2014 things like AI agents, numbers, calls, or knowledge bases. What would you like to do?\" Do not include the answer to their off-topic question anywhere in your reply.',
    '',
    NAV,
    '',
    'Current account snapshot (for grounding answers):',
    ctx,
    '',
    'When you want to point the user to a page, end your reply with a line exactly like: LINKS: /numbers | /calls  (pipe-separated paths, only from the list above). Omit the LINKS line if none apply.'
  ].join('\n');
}

const LABELS: Record<string, string> = {
  '/wallet': 'Wallet', '/calls': 'Calls', '/numbers': 'Numbers', '/connect': 'AI Agents',
  '/vans': 'AI Numbers', '/ai': 'AI Connections', '/sip': 'SIP', '/optimize': 'Optimize',
  '/blacklist': 'Blacklist', '/people': 'People', '/teams': 'Teams', '/crm': 'CRM',
  '/live-call': 'Live Call', '/apps': 'Apps', '/settings': 'Settings'
};

function previewFor(type: string, a: any): string {
  switch (type) {
    case 'create_van': return `Create Virtual AI Number "${a.name}" on ${a.telnum}` + (a.agentId ? ' (bound to the selected agent)' : '');
    case 'add_blacklist': return `Block ${a.telnum}` + (a.comment ? ` \u2014 ${a.comment}` : '');
    case 'create_department': return `Create department "${a.name}"`;
    case 'set_agent_language': return `Set the agent's language to ${a.language}`;
    case 'knowledge_url': return `Add ${a.url} to the agent's knowledge base`;
    case 'knowledge_drive': return `Import a Google Drive file into the agent's knowledge base`;
    case 'toggle_feature': return `${a.enabled ? 'Enable' : 'Disable'} ${a.feature}`;
    case 'buy_number': return `Purchase this phone number — this will charge your wallet. Review the cost shown before confirming.`;
    default: return 'Perform this action';
  }
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
    const agents = await db.select({ id: schema.aiAgents.id, name: schema.aiAgents.name, language: schema.aiAgents.language }).from(schema.aiAgents).where(eq(schema.aiAgents.tenantId, s.tenantId)).limit(25);
    const [vanCount] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.vans).where(eq(schema.vans.tenantId, s.tenantId)).catch(() => [{ n: 0 }] as any);
    const agentLines = agents.length ? agents.map((a) => `  - "${a.name}" id=${a.id} lang=${a.language}`).join('\n') : '  (none yet)';
    ctx = `AI agents (${agents.length}):\n${agentLines}\nVirtual AI Numbers: ${vanCount?.n ?? 0}`;
  } catch { ctx = '(snapshot unavailable)'; }

  let numbersCtx = '';
  if (/\b(buy|purchase|get|add|new)\b.*\bnumber\b|\bnumber\b.*\b(buy|purchase)\b|virtual number|phone number/i.test(message)) {
    try {
      const av: any = await $fetch('/api/numbers/available', { headers: { cookie: getHeader(event, 'cookie') || '' } });
      const cur = av?.currency || 'USD';
      const price = ((av?.firstMonthMinor ?? 0) / 100).toFixed(2);
      const list = (av?.numbers || []).slice(0, 8).map((n: any) => `  - ${n.telnum} (${n.regionLabel}) inventoryId=${n.id}`).join('\n');
      numbersCtx = `\n\nAvailable numbers to buy (first month ~${cur} ${price} each, DID + 1 channel):\n${list || '  (none available right now)'}`;
    } catch { /* ignore */ }
  }
  ctx += numbersCtx;

  // Cheap managed model (Haiku / gpt-4o-mini). Copilot is orchestration, not deep reasoning.
  const llm = await resolveAgentLlm(s.tenantId, null, true);
  if (!llm) throw apiError('unavailable', 'Copilot is not configured', 503);

  let raw = (await llmReply(llm, sysPrompt(ctx), [...history, { role: 'user', content: message }])) || '';

  // Parse an optional trailing ACTION: {json} line into a structured proposal.
  let action: any = null;
  const am = raw.match(/\n?ACTION:\s*(\{[\s\S]*\})\s*$/i);
  if (am) {
    try {
      const parsed = JSON.parse(am[1]);
      const ALLOWED = ['create_van','add_blacklist','create_department','set_agent_language','knowledge_url','knowledge_drive','toggle_feature','buy_number'];
      if (parsed && ALLOWED.includes(parsed.type) && parsed.args && typeof parsed.args === 'object') {
        action = { type: parsed.type, args: parsed.args, preview: previewFor(parsed.type, parsed.args) };
      }
    } catch { /* ignore malformed */ }
    raw = raw.slice(0, am.index).trim();
  }

  // Parse an optional trailing "LINKS: /a | /b" line into structured deep-links.
  const allowed = ['/wallet', '/calls', '/numbers', '/connect', '/vans', '/ai', '/sip', '/optimize', '/blacklist', '/people', '/teams', '/crm', '/live-call', '/apps', '/settings'];
  let reply = raw; let links: Array<{ label: string; to: string }> = [];
  const m = raw.match(/\n?LINKS:\s*(.+)\s*$/i);
  if (m) {
    reply = raw.slice(0, m.index).trim();
    links = m[1].split('|').map((p) => p.trim()).filter((p) => allowed.includes(p))
      .map((to) => ({ to, label: LABELS[to] || (to.replace('/', '').replace(/^\w/, (c) => c.toUpperCase()) || 'Open') }));
  }
  return { reply, links, action };
});
