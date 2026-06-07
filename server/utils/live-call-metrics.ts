// server/utils/live-call-metrics.ts
// Shared CSAT + call analytics for the Live Call feature, used by both the
// client page and the admin support console. Computes:
//  - Overview (totals, answered/missed/failed, response rate, avg CSAT)
//  - CSAT distribution (1-5)
//  - CSAT by agent (who handled the call)
//  - CSAT trend (daily, last 14 days)
//  - Customer feedback (recent rated sessions with comments)
import { eq, desc } from 'drizzle-orm';
import { useDb, schema } from '../db';

export async function computeLiveCallMetrics(tenantId: string) {
  const db = useDb();
  const all = await db.select().from(schema.liveCallSessions)
    .where(eq(schema.liveCallSessions.tenantId, tenantId))
    .orderBy(desc(schema.liveCallSessions.startedAt));

  const rated = all.filter((r) => r.csatScore != null);
  const dist = [0, 0, 0, 0, 0];
  rated.forEach((r) => { if (r.csatScore! >= 1 && r.csatScore! <= 5) dist[r.csatScore! - 1]++; });
  const avg = rated.length ? rated.reduce((a, r) => a + (r.csatScore || 0), 0) / rated.length : 0;

  // Outcomes
  const answered = all.filter((r) => r.outcome === 'answered' || r.status === 'connected' || r.status === 'ended').length;
  const missed = all.filter((r) => r.outcome === 'missed' || r.status === 'missed').length;
  const failed = all.filter((r) => r.outcome === 'failed' || r.outcome === 'abandoned').length;
  const calls = all.filter((r) => ['calling', 'connected', 'ended', 'missed'].includes(r.status)).length;

  // CSAT by agent
  const agentMap: Record<string, { label: string; count: number; sum: number }> = {};
  for (const r of rated) {
    const key = r.handledByLabel || (r.routedTo === 'ai' ? 'AI agent' : 'Unassigned');
    if (!agentMap[key]) agentMap[key] = { label: key, count: 0, sum: 0 };
    agentMap[key].count++; agentMap[key].sum += r.csatScore || 0;
  }
  const byAgent = Object.values(agentMap)
    .map((a) => ({ label: a.label, count: a.count, avg: Math.round((a.sum / a.count) * 100) / 100 }))
    .sort((a, b) => b.count - a.count);

  // CSAT trend (last 14 days, daily average)
  const days = 14;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const trend: { date: string; avg: number; count: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today); d.setDate(d.getDate() - i);
    const next = new Date(d); next.setDate(next.getDate() + 1);
    const dayRated = rated.filter((r) => { const t = new Date(r.startedAt as any); return t >= d && t < next; });
    const a = dayRated.length ? dayRated.reduce((s, r) => s + (r.csatScore || 0), 0) / dayRated.length : 0;
    trend.push({ date: d.toISOString().slice(0, 10), avg: Math.round(a * 100) / 100, count: dayRated.length });
  }

  // Customer feedback (recent rated, newest first)
  const feedback = rated
    .filter((r) => r.csatComment || r.csatScore)
    .slice(0, 25)
    .map((r) => ({
      id: r.id, name: r.visitorName || 'Visitor', score: r.csatScore,
      comment: r.csatComment || '', handledBy: r.handledByLabel || (r.routedTo === 'ai' ? 'AI agent' : '—'),
      location: [r.city, r.country].filter(Boolean).join(', '), when: r.startedAt
    }));

  const positive = rated.filter((r) => (r.csatScore || 0) >= 4).length;
  const satisfaction = rated.length ? Math.round((positive / rated.length) * 100) : 0;

  return {
    overview: {
      totalSessions: all.length,
      calls, answered, missed, failed,
      responseRate: calls ? Math.round((answered / calls) * 100) : 0,
      avgCsat: Math.round(avg * 100) / 100,
      satisfaction, // % rating 4-5
      byVisitorType: { visitor: all.filter((r) => r.visitorType === 'visitor').length, user: all.filter((r) => r.visitorType === 'user').length }
    },
    distribution: dist,
    ratedCount: rated.length,
    byAgent,
    trend,
    feedback
  };
}
