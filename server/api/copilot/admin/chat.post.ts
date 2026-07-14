// POST /api/copilot/admin/chat — the SUPERADMIN copilot (platform context).
// Mirrors the client copilot but authenticates with the admin session and grounds
// answers in platform-wide data instead of one workspace. Read/guide only.
import { requireSuperAdmin } from '~/server/utils/platform';
import { apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
import { sql } from 'drizzle-orm';
import { resolveAgentLlm, llmReply, type ChatMessage } from '~/server/utils/voice/ai-brain';

const NAV = `Accurate ADMIN page map — use these EXACT paths, never invent one:
- /admin/clients — all client workspaces (tenants)
- /admin/inventory — number inventory: buy/stock DIDs from carriers
- /admin/carriers — carrier config: Telnyx/Twilio keys, WebRTC, connection IDs
- /admin/pricing — number prices + managed AI pricing (STT/LLM/TTS + markup)
- /admin/plans — subscription plans and limits
- /admin/finance — cross-tenant revenue, wallet balances, transactions
- /admin/ai-usage — managed AI usage + costs platform-wide
- /admin/support — support tools: VANs, support numbers, live-call routing
- /admin/compliance — compliance settings
- /admin/audit — audit log of admin actions
- /admin/team — platform team members + roles
- /admin/settings — platform settings
- /admin/pbx-logs — live PBX/control-app logs
- /admin/sip-status — SIP endpoint status
- /admin/status — system status
- /admin/blacklist — global blocked numbers`;

const LABELS = {
  '/admin/clients': 'Clients', '/admin/inventory': 'Inventory', '/admin/carriers': 'Carriers',
  '/admin/pricing': 'Pricing', '/admin/plans': 'Plans', '/admin/finance': 'Finance',
  '/admin/ai-usage': 'AI usage', '/admin/support': 'Support', '/admin/compliance': 'Compliance',
  '/admin/audit': 'Audit', '/admin/team': 'Team', '/admin/settings': 'Settings',
  '/admin/pbx-logs': 'PBX logs', '/admin/sip-status': 'SIP status', '/admin/status': 'Status',
  '/admin/blacklist': 'Blacklist'
};
const ADMIN_PATHS = Object.keys(LABELS);

function sysPrompt(ctx) {
  return [
    'You are Telroi Admin Copilot, the in-app assistant for platform SUPERADMINS of a voice-AI SaaS.',
    'You help operators run the PLATFORM: client workspaces, number inventory and carriers, pricing and plans, platform finance, managed-AI usage, support tooling, compliance, and system status.',
    'Be concise and practical. Prefer 1-3 short sentences. When a task belongs on a specific admin page, say so briefly and include a deep-link.',
    'You are READ/GUIDE ONLY: you do NOT perform actions or spend money. Explain briefly and link the right admin page — never claim something is done.',
    'Where things live: carrier keys on /admin/carriers; managed AI pricing + number prices on /admin/pricing; cross-tenant revenue/wallets on /admin/finance; stocking DIDs on /admin/inventory; individual client management on /admin/clients. If unsure, say so and suggest the closest page.',
    'You are strictly a Telroi platform-admin assistant. If asked anything unrelated, do NOT answer — reply only with a brief redirect like "I can only help with running the Telroi platform. What do you need?"',
    '',
    NAV,
    '',
    'Current platform snapshot (for grounding answers):',
    ctx,
    '',
    'To point the operator to a page, end your reply with a line exactly like: LINKS: /admin/clients | /admin/finance  (pipe-separated, only from the admin list). Omit if none apply.'
  ].join('\n');
}

export default defineEventHandler(async (event) => {
  const admin = await requireSuperAdmin(event);
  const body = await readBody(event);
  const message = (body?.message || '').toString().trim();
  if (!message) throw apiError('invalid', 'message required', 400);
  const history = Array.isArray(body?.history)
    ? body.history.filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string').slice(-6)
    : [];

  const db = useDb();
  let ctx = '';
  try {
    const [tenants] = await db.select({ n: sql`count(*)::int` }).from(schema.tenants).catch(() => [{ n: 0 }]);
    const [activeSubs] = await db.select({ n: sql`count(*)::int` }).from(schema.numberSubscriptions).where(sql`status = 'active'`).catch(() => [{ n: 0 }]);
    const [invAvail] = await db.select({ n: sql`count(*)::int` }).from(schema.numberInventory).where(sql`status = 'available'`).catch(() => [{ n: 0 }]);
    const [vans] = await db.select({ n: sql`count(*)::int` }).from(schema.vans).catch(() => [{ n: 0 }]);
    ctx = [
      'Tenants (workspaces): ' + (tenants?.n ?? 0),
      'Active number subscriptions: ' + (activeSubs?.n ?? 0),
      'Available numbers in inventory: ' + (invAvail?.n ?? 0),
      'Virtual AI Numbers (platform-wide): ' + (vans?.n ?? 0),
      'Signed-in admin: ' + (admin.email || 'superadmin') + ' (role=' + admin.role + ')'
    ].join('\n');
  } catch { ctx = '(snapshot unavailable)'; }

  const llm = await resolveAgentLlm(null, null, true);
  if (!llm) throw apiError('unavailable', 'Copilot is not configured', 503);

  let raw = (await llmReply(llm, sysPrompt(ctx), [...history, { role: 'user', content: message }])) || '';

  let reply = raw; let links = [];
  const m = raw.match(/\n?LINKS:\s*(.+)\s*$/i);
  if (m) {
    reply = raw.slice(0, m.index).trim();
    links = m[1].split('|').map((p) => p.trim()).filter((p) => ADMIN_PATHS.includes(p)).map((to) => ({ to, label: LABELS[to] || 'Open' }));
  }
  return { reply, links, action: null };
});
