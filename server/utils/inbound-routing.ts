// server/utils/inbound-routing.ts
// Single, carrier-agnostic inbound-routing resolver. Every inbound path (PBX
// dialplan, Sotel/Twilio/Telnyx webhooks, the Live Call widget) consults THIS
// to decide how a call to a given number should be handled — so a number
// behaves the same regardless of which vendor carries it.
import { and, eq } from 'drizzle-orm';
import { useDb, schema } from '../db';

export type InboundRoute =
  | { type: 'person'; target: string | null; telnum: string; provider: string }
  | { type: 'department'; departmentId: string | null; telnum: string; provider: string }
  | { type: 'ai'; agentId: string | null; escalateTo: string | null; escalateAfter: number; telnum: string; provider: string }
  | { type: 'none'; telnum: string; provider: string };

export async function resolveInboundRoute(tenantId: string, telnum: string): Promise<InboundRoute> {
  const db = useDb();
  const [sub] = await db.select().from(schema.numberSubscriptions)
    .where(and(eq(schema.numberSubscriptions.tenantId, tenantId), eq(schema.numberSubscriptions.telnum, telnum))).limit(1);
  if (!sub) return { type: 'none', telnum, provider: 'telroi' };
  const provider = sub.provider;
  if (sub.routeType === 'ai') {
    return { type: 'ai', agentId: sub.routeAgentId || null, escalateTo: sub.routeEscalateTo || null, escalateAfter: sub.routeEscalateAfter || 0, telnum, provider };
  }
  if (sub.routeType === 'department') {
    return { type: 'department', departmentId: sub.departmentId || null, telnum, provider };
  }
  return { type: 'person', target: sub.routeTarget || null, telnum, provider };
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
  action: 'ai' | 'dial_person' | 'dial_department' | 'ivr' | 'reject';
  ivr?: IvrStep;
  greeting?: string;          // spoken greeting (AI agent greeting or default)
  agentId?: string | null;
  dialTarget?: string | null; // person extension / department ring target
  escalateTo?: string | null;
  escalateAfter?: number;
}

// Resolve the route AND enrich it for execution (loads the agent greeting, the
// department ring target). One function every inbound webhook calls.
// Map a Connect flow's entry node to an InboundAction. A published flow bound to
// a number OVERRIDES the flat subscription routing (publishing is the explicit
// 'make this live' action). Multi-step nodes (greeting -> menu) are represented
// as an IVR action the carrier webhooks render (Gather/dialplan).
async function resolveFlowAction(tenantId: string, telnum: string): Promise<InboundAction | null> {
  const db = useDb();
  const [flow] = await db.select().from(schema.connectFlows)
    .where(and(eq(schema.connectFlows.tenantId, tenantId), eq(schema.connectFlows.telnum, telnum), eq(schema.connectFlows.status, 'published'))).limit(1);
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
      return { action: 'ai', greeting, agentId };
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
  const [flow] = await db.select().from(schema.connectFlows)
    .where(and(eq(schema.connectFlows.tenantId, tenantId), eq(schema.connectFlows.telnum, telnum), eq(schema.connectFlows.status, 'published'))).limit(1);
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
    return { action: 'ai', greeting, agentId: route.agentId, escalateTo: route.escalateTo, escalateAfter: route.escalateAfter };
  }
  if (route.type === 'department') {
    let target: string | null = null;
    if (route.departmentId) {
      const [dept] = await db.select({ name: schema.departments.name }).from(schema.departments)
        .where(eq(schema.departments.id, route.departmentId)).limit(1);
      target = route.departmentId; // ring target = department id (PBX/queue resolves members)
      return { action: 'dial_department', dialTarget: target, greeting: dept?.name ? `Connecting you to ${dept.name}.` : undefined };
    }
    return { action: 'dial_department', dialTarget: null };
  }
  if (route.type === 'person') {
    return { action: 'dial_person', dialTarget: route.target };
  }
  return { action: 'reject' };
}
