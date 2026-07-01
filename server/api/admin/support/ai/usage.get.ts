// GET /api/admin/support/ai/usage?days=30 -> AI usage for the platform support workspace.
import { eq, and, gte, sql } from 'drizzle-orm';
import { requirePlatformAdmin } from '~/server/utils/platform';
import { ensureSupportWorkspace } from '~/server/utils/support';
import { useDb, schema } from '~/server/db';

export default defineEventHandler(async (event) => {
  await requirePlatformAdmin(event);
  const ws = await ensureSupportWorkspace();
  const q = getQuery(event);
  const days = Math.min(Math.max(Number(q.days) || 30, 1), 365);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const db = useDb();
  const rows = await db.select({
    agentId: schema.aiUsage.agentId,
    calls: sql<number>`count(distinct ${schema.aiUsage.callId})`,
    turns: sql<number>`count(*)`,
    sttSeconds: sql<number>`coalesce(sum(${schema.aiUsage.sttSeconds}),0)`,
    llmInputTokens: sql<number>`coalesce(sum(${schema.aiUsage.llmInputTokens}),0)`,
    llmOutputTokens: sql<number>`coalesce(sum(${schema.aiUsage.llmOutputTokens}),0)`,
    ttsChars: sql<number>`coalesce(sum(${schema.aiUsage.ttsChars}),0)`,
    costMinorUsd: sql<number>`coalesce(sum(${schema.aiUsage.costMinorUsd}),0)`,
    managed: sql<boolean>`bool_or(${schema.aiUsage.managed})`
  }).from(schema.aiUsage)
    .where(and(eq(schema.aiUsage.tenantId, ws.tenantId), gte(schema.aiUsage.createdAt, since)))
    .groupBy(schema.aiUsage.agentId);
  const agents = await db.select({ id: schema.aiAgents.id, name: schema.aiAgents.name })
    .from(schema.aiAgents).where(eq(schema.aiAgents.tenantId, ws.tenantId));
  const nameOf = new Map(agents.map((a) => [a.id, a.name]));
  const byAgent = rows.map((r) => ({
    agentId: r.agentId,
    agentName: r.agentId ? (nameOf.get(r.agentId) || 'Removed agent') : 'Unassigned',
    calls: Number(r.calls), turns: Number(r.turns),
    sttMinutes: Math.round(Number(r.sttSeconds) / 6) / 10,
    llmInputTokens: Number(r.llmInputTokens), llmOutputTokens: Number(r.llmOutputTokens),
    ttsChars: Number(r.ttsChars), managed: !!r.managed, costUsd: Number(r.costMinorUsd) / 100
  }));
  const total = byAgent.reduce((a, r) => ({
    calls: a.calls + r.calls, turns: a.turns + r.turns, sttMinutes: Math.round((a.sttMinutes + r.sttMinutes) * 10) / 10,
    llmInputTokens: a.llmInputTokens + r.llmInputTokens, llmOutputTokens: a.llmOutputTokens + r.llmOutputTokens,
    ttsChars: a.ttsChars + r.ttsChars, costUsd: Math.round((a.costUsd + r.costUsd) * 100) / 100
  }), { calls: 0, turns: 0, sttMinutes: 0, llmInputTokens: 0, llmOutputTokens: 0, ttsChars: 0, costUsd: 0 });
  return { days, byAgent, total };
});
