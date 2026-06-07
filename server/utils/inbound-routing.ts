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
export interface InboundAction {
  action: 'ai' | 'dial_person' | 'dial_department' | 'reject';
  greeting?: string;          // spoken greeting (AI agent greeting or default)
  agentId?: string | null;
  dialTarget?: string | null; // person extension / department ring target
  escalateTo?: string | null;
  escalateAfter?: number;
}

// Resolve the route AND enrich it for execution (loads the agent greeting, the
// department ring target). One function every inbound webhook calls.
export async function resolveInboundAction(tenantId: string, telnum: string): Promise<InboundAction> {
  const db = useDb();
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
