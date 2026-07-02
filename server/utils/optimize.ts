// server/utils/optimize.ts
// Telroi Optimize — provider-abstracted call-quality intelligence.
//
// Honest design: each carrier exposes different telemetry. We normalize to one
// shape and clearly mark which metrics are real vs. unavailable per provider.
//   - Telroi/Digitide PBX: operational metrics only (answer rate, wait, ratings,
//     duration) computed from call history. NO MOS/jitter — the API doesn't
//     expose them, so those come back null (not faked).
//   - Twilio:  Voice Insights gives real MOS, jitter, packet loss, PDD.
//   - Telnyx:  call-quality metrics via its Detail Records / Insights.
//
// A "route" here = a destination grouping (number, department, or carrier).

export interface QualityMetric {
  scope: string;            // e.g. number, department, or 'carrier:twilio'
  label: string;
  calls: number;
  answerRate: number | null;   // % answered (operational — always available)
  avgWaitSec: number | null;
  avgDurationSec: number | null;
  avgRating: number | null;    // 1-5 if ratings collected
  mos: number | null;          // carrier-grade — null when unavailable
  jitterMs: number | null;
  packetLossPct: number | null;
  pddMs: number | null;        // post-dial delay
  score: number;               // 0-100 composite (from whatever IS available)
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  signals: string[];           // human-readable flags
}

export interface QualityResult {
  provider: string;
  hasCarrierGrade: boolean;    // true only if MOS/jitter etc are real
  metrics: QualityMetric[];
  note?: string;               // honest caveat shown in UI
}

/* ---------------- scoring ---------------- */
function grade(score: number): QualityMetric['grade'] {
  if (score >= 90) return 'A';
  if (score >= 75) return 'B';
  if (score >= 60) return 'C';
  if (score >= 45) return 'D';
  return 'F';
}

// Composite from available signals. Operational-only routes are scored on
// answer rate + wait + rating; carrier-grade routes also fold in MOS.
function compositeScore(m: Partial<QualityMetric>): number {
  let score = 0, weight = 0;
  if (m.answerRate != null) { score += m.answerRate * 0.5; weight += 0.5; }
  if (m.avgWaitSec != null) { score += Math.max(0, 100 - m.avgWaitSec * 4) * 0.2; weight += 0.2; }
  if (m.avgRating != null) { score += (m.avgRating / 5) * 100 * 0.15; weight += 0.15; }
  if (m.mos != null) { score += (Math.min(m.mos, 4.5) / 4.5) * 100 * 0.4; weight += 0.4; }
  if (m.packetLossPct != null) { score += Math.max(0, 100 - m.packetLossPct * 10) * 0.15; weight += 0.15; }
  return weight ? Math.round(score / weight) : 0;
}

function signalsFor(m: Partial<QualityMetric>): string[] {
  const s: string[] = [];
  if (m.answerRate != null && m.answerRate < 70) s.push('Low answer rate');
  if (m.avgWaitSec != null && m.avgWaitSec > 20) s.push('High wait time');
  if (m.mos != null && m.mos < 3.5) s.push('Low MOS (poor audio)');
  if (m.packetLossPct != null && m.packetLossPct > 5) s.push('High packet loss');
  if (m.pddMs != null && m.pddMs > 5000) s.push('High post-dial delay');
  if (m.avgRating != null && m.avgRating < 3) s.push('Low customer rating');
  return s;
}

function finalize(partial: Partial<QualityMetric> & { scope: string; label: string; calls: number }): QualityMetric {
  const score = compositeScore(partial);
  return {
    answerRate: null, avgWaitSec: null, avgDurationSec: null, avgRating: null,
    mos: null, jitterMs: null, packetLossPct: null, pddMs: null,
    ...partial,
    score,
    grade: grade(score),
    signals: signalsFor(partial)
  };
}

/* ---------------- Telroi PBX: operational metrics from call history ---------------- */
export function telroiQuality(calls: any[]): QualityResult {
  // Route = department/queue when the call reports one, else the dialed number.
  const groups = new Map<string, any[]>();
  for (const c of calls) {
    const key = c.group_name || c.diversion || c.telnum_name || 'unknown';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(c);
  }
  // Answered = real talk time AND not flagged missed/failed by Asterisk.
  const isAnswered = (c: any) => (c.duration || 0) > 0 && c.status !== 'failed' && c.status !== 'busy' && !c.missedStatus;
  const metrics: QualityMetric[] = [];
  for (const [scope, items] of groups) {
    const answered = items.filter(isAnswered);
    const rated = items.filter((c) => c.rating);
    const failed = items.filter((c) => c.status === 'failed' || c.missedStatus === 2);
    const busy = items.filter((c) => c.status === 'busy');
    const m = finalize({
      scope, label: scope, calls: items.length,
      answerRate: items.length ? Math.round((answered.length / items.length) * 100) : null,
      avgWaitSec: answered.length ? Math.round(answered.reduce((s, c) => s + (c.wait || 0), 0) / answered.length) : null,
      avgDurationSec: answered.length ? Math.round(answered.reduce((s, c) => s + (c.duration || 0), 0) / answered.length) : null,
      avgRating: rated.length ? +(rated.reduce((s, c) => s + c.rating, 0) / rated.length).toFixed(1) : null
    });
    // Extra outcome signals straight from the Asterisk status detail.
    if (items.length >= 5 && failed.length / items.length > 0.15) m.signals.push('High failure rate');
    if (items.length >= 5 && busy.length / items.length > 0.15) m.signals.push('Frequently busy');
    metrics.push(m);
  }
  metrics.sort((a, b) => a.score - b.score); // worst first — that's what needs attention
  return {
    provider: 'telroi',
    hasCarrierGrade: false,
    metrics,
    note: 'Telroi reports operational metrics (answer rate, wait, ratings, call outcomes) from your Asterisk call history. Carrier-grade audio metrics (MOS, jitter, packet loss) appear on routes that report them.'
  };
}

/* ---------------- Twilio: real Voice Insights ---------------- */
export async function twilioQuality(creds: { accountSid: string; authToken: string }): Promise<QualityResult> {
  // Voice Insights Call Summaries carry MOS/jitter/packet-loss/PDD per call.
  // We aggregate the recent window. (Requires Voice Insights enabled on the account.)
  const auth = 'Basic ' + Buffer.from(`${creds.accountSid}:${creds.authToken}`).toString('base64');
  try {
    const r = await fetch(
      `https://insights.twilio.com/v1/Voice/Summaries?PageSize=50`,
      { headers: { Authorization: auth } }
    );
    if (!r.ok) {
      return { provider: 'twilio', hasCarrierGrade: false, metrics: [],
        note: `Carrier-grade metrics are not available right now (HTTP ${r.status}).` };
    }
    const data = await r.json();
    const summaries: any[] = data.summaries || data.call_summaries || [];
    // Bucket by carrier edge (route). Pull metrics from the carrier_edge.
    const grp = new Map<string, any[]>();
    for (const s of summaries) {
      const edge = s.carrier_edge || s.sdk_edge || {};
      const key = edge?.properties?.region || s.call_type || 'twilio';
      if (!grp.has(key)) grp.set(key, []);
      grp.get(key)!.push(s);
    }
    const metrics: QualityMetric[] = [];
    for (const [scope, items] of grp) {
      const mosVals = items.map((i) => i.carrier_edge?.metrics?.inbound?.mos?.avg).filter((v) => v != null);
      const jitterVals = items.map((i) => i.carrier_edge?.metrics?.inbound?.jitter?.avg).filter((v) => v != null);
      const plVals = items.map((i) => i.carrier_edge?.metrics?.inbound?.packet_loss?.avg).filter((v) => v != null);
      const pddVals = items.map((i) => i.attributes?.pdd_ms).filter((v) => v != null);
      const avg = (a: number[]) => a.length ? a.reduce((s, v) => s + v, 0) / a.length : null;
      metrics.push(finalize({
        scope: `carrier:twilio:${scope}`, label: `Carrier · ${scope}`, calls: items.length,
        mos: mosVals.length ? +(avg(mosVals)!).toFixed(2) : null,
        jitterMs: jitterVals.length ? +(avg(jitterVals)!).toFixed(1) : null,
        packetLossPct: plVals.length ? +(avg(plVals)!).toFixed(1) : null,
        pddMs: pddVals.length ? Math.round(avg(pddVals)!) : null,
        answerRate: null
      }));
    }
    return { provider: 'twilio', hasCarrierGrade: metrics.some((m) => m.mos != null), metrics };
  } catch (e: any) {
    return { provider: 'twilio', hasCarrierGrade: false, metrics: [], note: `Carrier-grade metrics are temporarily unavailable.` };
  }
}

/* ---------------- Telnyx: call-quality via Detail Records ---------------- */
export async function telnyxQuality(creds: { apiKey: string }): Promise<QualityResult> {
  try {
    // Telnyx exposes call quality in its Detail Records / Call Events.
    const r = await fetch('https://api.telnyx.com/v2/detail_records?filter[record_type]=voice&page[size]=50', {
      headers: { Authorization: `Bearer ${creds.apiKey}` }
    });
    if (!r.ok) {
      return { provider: 'telnyx', hasCarrierGrade: false, metrics: [],
        note: `Carrier-grade metrics are not available right now (HTTP ${r.status}).` };
    }
    const data = await r.json();
    const recs: any[] = data.data || [];
    const grp = new Map<string, any[]>();
    for (const rec of recs) {
      const key = rec.from_carrier || rec.tech_prefix || 'telnyx';
      if (!grp.has(key)) grp.set(key, []);
      grp.get(key)!.push(rec);
    }
    const metrics: QualityMetric[] = [];
    for (const [scope, items] of grp) {
      const mosVals = items.map((i) => parseFloat(i.mos)).filter((v) => !isNaN(v));
      const jitterVals = items.map((i) => parseFloat(i.jitter)).filter((v) => !isNaN(v));
      const avg = (a: number[]) => a.length ? a.reduce((s, v) => s + v, 0) / a.length : null;
      metrics.push(finalize({
        scope: `carrier:telnyx:${scope}`, label: `Carrier · ${scope}`, calls: items.length,
        mos: mosVals.length ? +(avg(mosVals)!).toFixed(2) : null,
        jitterMs: jitterVals.length ? +(avg(jitterVals)!).toFixed(1) : null
      }));
    }
    return { provider: 'telnyx', hasCarrierGrade: metrics.some((m) => m.mos != null), metrics };
  } catch (e: any) {
    return { provider: 'telnyx', hasCarrierGrade: false, metrics: [], note: `Carrier-grade metrics are temporarily unavailable.` };
  }
}


// ── AI agent performance ─────────────────────────────────────────────────────
// Cheap DB-only aggregation (no external calls, no per-call analysis) that shows
// how well each AI agent is handling calls: volume, how many it resolved itself
// vs. escalated to a human, and average managed cost per call. Usage detail
// (tokens/seconds) lives on the AI Usage page — not duplicated here.
export interface AiAgentPerf {
  agentId: string; name: string; tier: string;
  calls: number; escalated: number; escalationРct?: never; // (avoid typo field)
  escalationPct: number; resolvedPct: number;
  avgCostMinorUsd: number; flag: string | null;
}

export async function aiAgentPerformance(db: any, schema: any, tenantId: string, sinceDays: number): Promise<AiAgentPerf[]> {
  const { and, eq, gte } = await import('drizzle-orm');
  const since = new Date(Date.now() - sinceDays * 86400000);
  // Every AI-handled call (one row per turn; group to calls per agent).
  const usage = await db.select().from(schema.aiUsage)
    .where(and(eq(schema.aiUsage.tenantId, tenantId), gte(schema.aiUsage.createdAt, since)));
  if (!usage.length) return [];
  // Escalated calls = call_events for this tenant that were taken over by a human.
  const events = await db.select().from(schema.callEvents)
    .where(and(eq(schema.callEvents.tenantId, tenantId), gte(schema.callEvents.startedAt, since)));
  const escalatedCallIds = new Set(
    events.filter((e: any) => e.takenOverAt || e.handledBy === 'human').map((e: any) => e.callid)
  );
  const agents = await db.select().from(schema.aiAgents).where(eq(schema.aiAgents.tenantId, tenantId));
  const nameOf = (id: string) => agents.find((a: any) => a.id === id)?.name || 'Unknown agent';
  const tierOf = (id: string) => agents.find((a: any) => a.id === id)?.tier || 'byok';

  // Group usage rows into calls per agent.
  const byAgent = new Map<string, { calls: Set<string>; cost: number; escalated: Set<string> }>();
  for (const u of usage) {
    if (!u.agentId) continue;
    const g = byAgent.get(u.agentId) || { calls: new Set(), cost: 0, escalated: new Set() };
    if (u.callId) { g.calls.add(u.callId); if (escalatedCallIds.has(u.callId)) g.escalated.add(u.callId); }
    g.cost += u.costMinorUsd || 0;
    byAgent.set(u.agentId, g);
  }
  const out: AiAgentPerf[] = [];
  for (const [agentId, g] of byAgent) {
    const calls = g.calls.size || 0;
    const escalated = g.escalated.size || 0;
    const escalationPct = calls ? Math.round((escalated / calls) * 100) : 0;
    const resolvedPct = calls ? 100 - escalationPct : 0;
    const avgCostMinorUsd = calls ? Math.round(g.cost / calls) : 0;
    // Flag only the obvious problem: escalating most calls means the AI isn't coping.
    const flag = escalationPct >= 50 && calls >= 3 ? 'High escalation' : null;
    out.push({ agentId, name: nameOf(agentId), tier: tierOf(agentId), calls, escalated, escalationPct, resolvedPct, avgCostMinorUsd, flag } as AiAgentPerf);
  }
  out.sort((a, b) => b.escalationPct - a.escalationPct); // worst first
  return out;
}
