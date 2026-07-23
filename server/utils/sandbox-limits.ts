// server/utils/sandbox-limits.ts
// One place that answers "what can this sandbox workspace still do?".
//
// Sandbox is where a new workspace proves the product works before any real money
// moves: a limited number of test calls and a single live AI agent pointed at real
// numbers. Limits come from platform_settings, and a tenant row can override
// either to extend a specific trial without changing everyone's.
//
// Usage is counted from call_events rather than a counter column — a counter
// drifts the moment a write fails or someone edits the DB by hand, and this gates
// billing, so it needs to be right rather than fast.
import { and, count, eq, isNull, sql } from 'drizzle-orm';
import { useDb, schema } from '~/server/db';

export interface SandboxStatus {
  sandbox: boolean;      // false once the workspace is live — limits don't apply
  callCap: number;
  callsUsed: number;
  callsLeft: number;
  agentCap: number;
  agentsUsed: number;
  agentsLeft: number;
  callsExhausted: boolean;
  agentsExhausted: boolean;
}

export async function sandboxStatus(tenantId: string): Promise<SandboxStatus> {
  const db = useDb();

  const [tenant] = await db.select({
    sandboxMode: schema.tenants.sandboxMode,
    callCap: schema.tenants.sandboxCallCap,
    agentCap: schema.tenants.sandboxAgentCap
  }).from(schema.tenants).where(eq(schema.tenants.id, tenantId)).limit(1);

  const [platform] = await db.select({
    callCap: schema.platformSettings.sandboxCallCap,
    agentCap: schema.platformSettings.sandboxAgentCap
  }).from(schema.platformSettings).limit(1);

  const callCap = tenant?.callCap ?? platform?.callCap ?? 20;
  const agentCap = tenant?.agentCap ?? platform?.agentCap ?? 1;

  // A live workspace has no limits; skip the counting entirely.
  if (!tenant?.sandboxMode) {
    return {
      sandbox: false,
      callCap, callsUsed: 0, callsLeft: callCap,
      agentCap, agentsUsed: 0, agentsLeft: agentCap,
      callsExhausted: false, agentsExhausted: false
    };
  }

  const [calls] = await db.select({ n: count() })
    .from(schema.callEvents)
    .where(eq(schema.callEvents.tenantId, tenantId));

  const [agents] = await db.select({ n: count() })
    .from(schema.vans)
    .where(and(eq(schema.vans.tenantId, tenantId), eq(schema.vans.status, 'live')));

  const callsUsed = calls?.n ?? 0;
  const agentsUsed = agents?.n ?? 0;

  return {
    sandbox: true,
    callCap, callsUsed, callsLeft: Math.max(0, callCap - callsUsed),
    agentCap, agentsUsed, agentsLeft: Math.max(0, agentCap - agentsUsed),
    callsExhausted: callsUsed >= callCap,
    agentsExhausted: agentsUsed >= agentCap
  };
}
