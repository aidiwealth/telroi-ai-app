// server/utils/inbound-routing.ts
// Single, carrier-agnostic inbound-routing resolver. Every inbound path (PBX
// dialplan, Sotel/Twilio/Telnyx webhooks, the Live Call widget) consults THIS
// to decide how a call to a given number should be handled — so a number
// behaves the same regardless of which vendor carries it.
import { and, eq, gte, sql } from 'drizzle-orm';
import { useDb, schema } from '../db';

export type InboundRoute =
  | { type: 'person'; target: string | null; telnum: string; provider: string; recordCalls?: boolean }
  | { type: 'department'; departmentId: string | null; telnum: string; provider: string; recordCalls?: boolean }
  | { type: 'ring_all'; telnum: string; provider: string; recordCalls?: boolean }
  | { type: 'ai'; agentId: string | null; escalateMode: string | null; escalateTo: string | null; escalateAfter: number; telnum: string; provider: string; recordCalls?: boolean }
  | { type: 'none'; telnum: string; provider: string };

/** Has this workspace spent its daily AI allowance?
 *
 *  Runs on every inbound call to an AI number, so it is one summed query over an
 *  indexed range rather than anything clever. Failing open: an error here should
 *  not stop a client's calls being answered — the cap is a courtesy, and losing
 *  a day's calls to protect a few dollars would be the wrong trade.
 */
async function aiCapReached(tenantId: string): Promise<boolean> {
  try {
    const db = useDb();
    const [t] = await db.select({
      cap: schema.tenants.aiDailyCapUsdMinor,
      tz: schema.tenants.timezone
    }).from(schema.tenants).where(eq(schema.tenants.id, tenantId)).limit(1);

    const { getPricing } = await import('./pricing');
    const pricing: any = await getPricing(tenantId).catch(() => null);
    // The workspace's own figure, or the platform's. Zero means no cap at all.
    const capUsdMinor = t?.cap ?? pricing?.aiDailyCapUsdMinor ?? 500;
    if (!capUsdMinor || capUsdMinor <= 0) return false;

    // Their midnight, not ours — a Lagos client's day should end in Lagos.
    const since = startOfDayIn(t?.tz || 'Africa/Lagos');
    const [row] = await db.select({ spent: sql<number>`coalesce(sum(${schema.ledger.amountMinor}), 0)` })
      .from(schema.ledger)
      .where(and(
        eq(schema.ledger.tenantId, tenantId),
        eq(schema.ledger.reason, 'ai_managed'),
        eq(schema.ledger.kind, 'debit'),
        gte(schema.ledger.createdAt, since)
      ));

    // The cap is in USD; the ledger is in the wallet's currency.
    const ngnPerUsd = Number(pricing?.ngnPerUsd) || 1600;
    const [w] = await db.select({ currency: schema.wallets.currency })
      .from(schema.wallets).where(eq(schema.wallets.tenantId, tenantId)).limit(1);
    const capInWallet = w?.currency === 'NGN' ? Math.round(capUsdMinor * ngnPerUsd) : capUsdMinor;

    return Number(row?.spent || 0) >= capInWallet;
  } catch (e: any) {
    // Said out loud. Failing open is right — losing a day's calls to protect a
    // few dollars would be the wrong trade — but a check that silently never
    // applies looks exactly like a cap that works, and this one was shipped
    // with a missing import that would have done precisely that.
    console.error('[ai-cap] check failed, allowing the call:', e?.message);
    return false;
  }
}

/** Midnight today, in the workspace's own timezone. */
function startOfDayIn(tz: string): Date {
  const now = new Date();
  const local = new Date(now.toLocaleString('en-US', { timeZone: tz }));
  const offset = now.getTime() - local.getTime();
  local.setHours(0, 0, 0, 0);
  return new Date(local.getTime() + offset);
}

export async function resolveInboundRoute(tenantId: string, telnum: string): Promise<InboundRoute> {
  const db = useDb();
  const [sub] = await db.select().from(schema.numberSubscriptions)
    .where(and(eq(schema.numberSubscriptions.tenantId, tenantId), eq(schema.numberSubscriptions.telnum, telnum))).limit(1);
  if (!sub) return { type: 'none', telnum, provider: 'telroi' };
  const provider = sub.provider;
  if (sub.routeType === 'ai') {
    // A ceiling on what AI can spend in a day. A client cannot choose who rings
    // their number, and an agent that listens, reasons and speaks for a
    // robocaller costs real money for a call nobody wanted — without a bound the
    // first they know is the bill.
    //
    // Over it, the AI does not answer and the call takes whatever the number's
    // escalation target would have been. A caller reaching a person is a good
    // outcome; one answered by something nobody can pay for is not.
    if (await aiCapReached(tenantId)) {
      if (sub.routeEscalateMode === 'ring_all') return { type: 'ring_all', telnum, provider, recordCalls: !!sub.recordCalls };
      if (sub.routeEscalateTo) return { type: 'person', target: sub.routeEscalateTo, telnum, provider, recordCalls: !!sub.recordCalls };
      return { type: 'none', telnum, provider };
    }
    return { type: 'ai', agentId: sub.routeAgentId || null, escalateMode: sub.routeEscalateMode || 'none', escalateTo: sub.routeEscalateTo || null, escalateAfter: sub.routeEscalateAfter || 0, telnum, provider, recordCalls: !!sub.recordCalls };
  }
  if (sub.routeType === 'department') {
    return { type: 'department', departmentId: sub.departmentId || null, telnum, provider, recordCalls: !!sub.recordCalls };
  }
  if (sub.routeType === 'ring_all') {
    return { type: 'ring_all', telnum, provider, recordCalls: !!sub.recordCalls };
  }
  // Anything unrecognised falls through to person — which is why ring_all became
  // a person route with no target, and the call was answered and then dropped in
  // silence.
  return { type: 'person', target: sub.routeTarget || null, telnum, provider, recordCalls: !!sub.recordCalls };
}

// A carrier-agnostic description of what to DO with an inbound call, resolved
// from the unified route. Each carrier webhook renders this into its own format
// (TwiML for Twilio, Call Control commands for Telnyx, dialplan for the PBX).
export interface IvrStep {
  kind: 'say' | 'menu' | 'voicemail';
  nodeId?: string;                                             // the flow node this step is
  text: string;
  nextNodeId?: string | null;                                  // 'say': where to go after speaking
  options?: Array<{ digit: string; nextNodeId: string | null; label?: string }>; // 'menu'
}
export interface InboundAction {
  action: 'ai' | 'dial_person' | 'dial_department' | 'ring_all' | 'ivr' | 'reject';
  // Whether this number records. Carried on the action because the webhook that
  // starts recording has the action and not the route.
  recordCalls?: boolean;
  ivr?: IvrStep;
  greeting?: string;          // spoken greeting (AI agent greeting or default)
  agentId?: string | null;
  dialTarget?: string | null; // person extension / department ring target
  escalateTo?: string | null;
  escalateAfter?: number;
  escalateMode?: string | null; // none | phone | endpoint | ring_all
}

// Resolve the route AND enrich it for execution (loads the agent greeting, the
// department ring target). One function every inbound webhook calls.
// Map a Connect flow's entry node to an InboundAction. A published flow bound to
// a number OVERRIDES the flat subscription routing (publishing is the explicit
// 'make this live' action). Multi-step nodes (greeting -> menu) are represented
// as an IVR action the carrier webhooks render (Gather/dialplan).
async function resolveFlowAction(tenantId: string, telnum: string): Promise<InboundAction | null> {
  const db = useDb();
  const digits = (v: string) => (v || '').replace(/\D/g, '');
  const want = digits(telnum);
  const pub = await db.select().from(schema.connectFlows)
    .where(and(eq(schema.connectFlows.tenantId, tenantId), eq(schema.connectFlows.status, 'published')));
  const flow = pub.find((fl) => { const h = digits(fl.telnum || ''); return h && want && (h === want || h.endsWith(want) || want.endsWith(h)); });
  if (!flow || !Array.isArray(flow.nodes) || !flow.nodes.length) return null;
  return await nodeToAction(tenantId, flow.nodes as any[], (flow.nodes as any[])[0]?.id);
}

// Resolve a specific node (by id) in a flow into an InboundAction. IVR menus
// carry their option map so the webhook can branch on the pressed digit by
// re-entering the flow at the chosen node.
async function nodeToAction(tenantId: string, nodes: any[], nodeId: string | undefined): Promise<InboundAction> {
  const db = useDb();
  const node = nodes.find((n) => n.id === nodeId) || nodes[0];
  if (!node) return { action: 'reject' };
  switch (node.type) {
    case 'greeting': {
      return { action: 'ivr', ivr: { nodeId: node.id, kind: 'say', text: node.config?.text || '', nextNodeId: node.config?.next || nodes[nodes.indexOf(node) + 1]?.id || null } };
    }
    case 'menu': {
      const options = (node.config?.options || []).map((o: any) => ({ digit: String(o.digit ?? o.key ?? ''), nextNodeId: o.target || o.next || null, label: o.label || '' }));
      return { action: 'ivr', ivr: { nodeId: node.id, kind: 'menu', text: node.config?.text || node.config?.prompt || 'Please choose an option.', options } };
    }
    case 'route_van': {
      let greeting = 'Hello, thanks for calling. How can I help you today?';
      const agentId = node.config?.target || null;
      if (agentId) {
        const [agent] = await db.select({ greeting: schema.aiAgents.greeting }).from(schema.aiAgents).where(eq(schema.aiAgents.id, agentId)).limit(1);
        if (agent?.greeting) greeting = agent.greeting;
      }
      // recordCalls travels with every other action and was missing from this
      // one, so a number routed to AI — which is most of them — asked Twilio to
      // record nothing however the setting was set. The comment on the type
      // says this is carried; it was, four times out of five.
      return { action: 'ai', greeting, agentId, recordCalls: (route as any).recordCalls };
    }
    case 'route_user': return { action: 'dial_person', dialTarget: node.config?.target || null };
    case 'route_group': return { action: 'dial_department', dialTarget: node.config?.target || null };
    case 'voicemail': return { action: 'ivr', ivr: { nodeId: node.id, kind: 'voicemail', text: node.config?.text || '' } };
    case 'hangup': return { action: 'reject' };
    default: return { action: 'reject' };
  }
}

// Public helper so webhooks can advance an IVR to the node a pressed digit maps to.
export async function resolveFlowNode(tenantId: string, telnum: string, nodeId: string): Promise<InboundAction> {
  const db = useDb();
  const digits = (v: string) => (v || '').replace(/\D/g, '');
  const want = digits(telnum);
  const pub = await db.select().from(schema.connectFlows)
    .where(and(eq(schema.connectFlows.tenantId, tenantId), eq(schema.connectFlows.status, 'published')));
  const flow = pub.find((fl) => { const h = digits(fl.telnum || ''); return h && want && (h === want || h.endsWith(want) || want.endsWith(h)); });
  if (!flow || !Array.isArray(flow.nodes)) return { action: 'reject' };
  return await nodeToAction(tenantId, flow.nodes as any[], nodeId);
}

export async function resolveInboundAction(tenantId: string, telnum: string): Promise<InboundAction> {
  const db = useDb();
  // Published Connect flow takes precedence over flat routing.
  const flowAction = await resolveFlowAction(tenantId, telnum);
  if (flowAction) return flowAction;
  const route = await resolveInboundRoute(tenantId, telnum);
  if (route.type === 'ai') {
    let greeting = 'Hello, thanks for calling. How can I help you today?';
    if (route.agentId) {
      const [agent] = await db.select({ greeting: schema.aiAgents.greeting }).from(schema.aiAgents)
        .where(eq(schema.aiAgents.id, route.agentId)).limit(1);
      if (agent?.greeting) greeting = agent.greeting;
    }
    return { action: 'ai', greeting, agentId: route.agentId, escalateTo: route.escalateTo, escalateAfter: route.escalateAfter, escalateMode: route.escalateMode, recordCalls: (route as any).recordCalls };
  }
  if (route.type === 'department') {
    let target: string | null = null;
    if (route.departmentId) {
      const [dept] = await db.select({ name: schema.departments.name }).from(schema.departments)
        .where(eq(schema.departments.id, route.departmentId)).limit(1);
      target = route.departmentId; // ring target = department id (PBX/queue resolves members)
      return { action: 'dial_department', dialTarget: target, greeting: dept?.name ? `Connecting you to ${dept.name}.` : undefined, recordCalls: (route as any).recordCalls };
    }
    return { action: 'dial_department', dialTarget: null, recordCalls: (route as any).recordCalls };
  }
  if (route.type === 'person') {
    return { action: 'dial_person', dialTarget: route.target, recordCalls: (route as any).recordCalls };
  }
  // Ring everyone who's free. The carrier can't reach our agents itself — they're
  // registered to our PBX — so the caller is handed there, the same way an AI call
  // reaches a human.
  if (route.type === 'ring_all') {
    return { action: 'ring_all', recordCalls: route.recordCalls };
  }
  return { action: 'reject' };
}
