<template>
  <div>
    <div class="page-head op-head">
      <div>
        <h1 class="page-title">Optimize</h1>
        <p class="page-sub">Route intelligence, fraud detection and AI performance across all traffic — SIP, API, direct and carrier — scored on real call data.</p>
      </div>
      <div class="op-controls">
        <select v-model="period" class="select op-period" @change="load">
          <option value="week">Last 7 days</option>
          <option value="month">Last 30 days</option>
          <option value="quarter">Last 90 days</option>
        </select>
        <button class="btn btn-ghost btn-sm" :disabled="pending || !report" @click="downloadReport">Download report</button>
      </div>
    </div>

    <div class="op-tabs">
      <button v-for="t in tabs" :key="t.key" class="op-tab" :class="{ on: tab === t.key }" @click="tab = t.key">
        {{ t.label }}<span v-if="t.badge != null && t.badge > 0" class="op-tab-badge">{{ t.badge }}</span>
      </button>
    </div>

    <div v-if="pending" class="op-loading"><div v-for="i in 4" :key="i" class="skeleton skel-row" /></div>

    <template v-else-if="report">
      <div v-show="tab === 'overview'" class="op-overview">
        <div class="op-summary">
          <div class="stat">
            <div class="stat-label">Estate score</div>
            <div class="stat-value" :style="scoreColor(report.overview.avgScore)">{{ report.overview.avgScore ?? '—' }}<span class="unit" v-if="report.overview.avgScore != null">/100</span></div>
            <div class="stat-meta">Across {{ report.overview.totalRoutes }} routes</div>
          </div>
          <div class="stat">
            <div class="stat-label">Total calls</div>
            <div class="stat-value">{{ report.overview.totalCalls }}</div>
            <div class="stat-meta">{{ report.overview.answerRate }}% answered</div>
          </div>
          <div class="stat">
            <div class="stat-label">Routes at risk</div>
            <div class="stat-value" :style="report.overview.routesAtRisk ? 'color:var(--danger)' : ''">{{ report.overview.routesAtRisk }}</div>
            <div class="stat-meta">Lowest-scoring routes</div>
          </div>
          <div class="stat">
            <div class="stat-label">AI resolution</div>
            <div class="stat-value">{{ report.overview.aiResolvedPct }}<span class="unit">%</span></div>
            <div class="stat-meta">{{ report.overview.aiCalls }} AI calls</div>
          </div>
          <div class="stat">
            <div class="stat-label">Fraud alerts</div>
            <div class="stat-value" :style="report.overview.fraudAlerts ? 'color:var(--danger)' : ''">{{ report.overview.fraudAlerts }}</div>
            <div class="stat-meta">{{ report.overview.fraudAlerts ? 'Needs review' : 'All clear' }}</div>
          </div>
        </div>
        <div class="op-overview-cols">
          <div class="card op-mini">
            <div class="card-head"><span class="card-title">Routes needing attention</span><button class="op-link" @click="tab = 'routes'">View all →</button></div>
            <table v-if="worstRoutes.length" class="table op-table">
              <thead><tr><th>Route</th><th>Calls</th><th>Answer</th><th>Grade</th></tr></thead>
              <tbody>
                <tr v-for="r in worstRoutes" :key="r.route">
                  <td class="op-route">{{ r.label }} <span class="muted op-dir">{{ r.carrier }}·{{ r.direction }}</span></td>
                  <td class="mono">{{ r.calls }}</td>
                  <td class="mono">{{ r.answerRate }}%</td>
                  <td><span class="op-grade" :class="`g-${r.grade}`">{{ r.grade }}</span></td>
                </tr>
              </tbody>
            </table>
            <EmptyState v-else icon="quality" title="No route data yet" description="Route scoring appears once calls flow through your account." />
          </div>
          <div class="card op-mini">
            <div class="card-head"><span class="card-title">AI at a glance</span><button class="op-link" @click="tab = 'ai'">Details →</button></div>
            <div class="op-ai-glance">
              <div class="op-glance-row"><span>AI calls</span><strong>{{ report.ai.totals.calls }}</strong></div>
              <div class="op-glance-row"><span>Resolved by AI</span><strong>{{ report.overview.aiResolvedPct }}%</strong></div>
              <div class="op-glance-row"><span>STT minutes</span><strong>{{ report.ai.totals.sttMinutes }}</strong></div>
              <div class="op-glance-row"><span>LLM tokens</span><strong>{{ fmtTok(report.ai.totals.llmTokens) }}</strong></div>
              <div v-if="report.ai.totals.costUsd > 0" class="op-glance-row"><span>Managed cost</span><strong>${{ report.ai.totals.costUsd.toFixed(2) }}</strong></div>
            </div>
          </div>
        </div>
      </div>

      <div v-show="tab === 'routes'">
        <div class="card op-provider">
          <div class="card-head">
            <span class="card-title">Route intelligence</span>
            <span class="chip" :class="report.overview.hasCarrierGrade ? 'chip--ok' : ''">{{ report.overview.hasCarrierGrade ? 'Carrier-grade' : 'Operational' }}</span>
          </div>
          <div class="op-note">Every route scored on real call data — answer rate, wait, ratings, and carrier audio metrics where available. Worst first.</div>
          <div class="op-legend">
            <span class="op-leg"><span class="op-grade g-A">A</span> Excellent</span>
            <span class="op-leg"><span class="op-grade g-B">B</span> Good</span>
            <span class="op-leg"><span class="op-grade g-C">C</span> Fair</span>
            <span class="op-leg"><span class="op-grade g-D">D</span> Poor</span>
            <span class="op-leg"><span class="op-grade g-F">F</span> Critical</span>
          </div>
          <table v-if="report.routes.length" class="table op-table">
            <thead>
              <tr><th>Route</th><th>Carrier</th><th>Dir</th><th>Calls</th><th>Score</th><th>Answer</th><th>Wait</th><th>Avg dur</th><th>Rating</th><th>Signals</th></tr>
            </thead>
            <tbody>
              <tr v-for="r in report.routes" :key="r.route">
                <td class="op-route">{{ r.label }}</td>
                <td>{{ r.carrier }}</td>
                <td>{{ r.direction }}</td>
                <td class="mono">{{ r.calls }}</td>
                <td><span class="op-grade" :class="`g-${r.grade}`">{{ r.grade }}</span> <span class="mono op-score">{{ r.score }}</span></td>
                <td class="mono">{{ r.answerRate }}%</td>
                <td class="mono">{{ r.avgWaitSec != null ? r.avgWaitSec + 's' : '—' }}</td>
                <td class="mono">{{ r.avgDurationSec != null ? r.avgDurationSec + 's' : '—' }}</td>
                <td class="mono">{{ r.avgRating != null ? r.avgRating + '★' : '—' }}</td>
                <td class="op-signals">
                  <span v-for="sig in r.signals" :key="sig" class="chip chip--missed op-sig">{{ sig }}</span>
                  <span v-if="!r.signals.length" class="muted">—</span>
                </td>
              </tr>
            </tbody>
          </table>
          <EmptyState v-else icon="quality" title="No route data yet" description="Once calls flow through your account, every route is scored and graded here." />
          <p v-if="report.carrierNotes.length" class="op-foot muted">{{ report.carrierNotes.join(' · ') }}</p>
        </div>
      </div>

      <div v-show="tab === 'ai'">
        <div class="card op-provider">
          <div class="card-head"><span class="card-title">AI performance</span><span class="chip">{{ report.ai.agents.length }} agent{{ report.ai.agents.length === 1 ? '' : 's' }}</span></div>
          <div class="op-note">How well each agent handles calls. Escalation = calls handed to a human.</div>
          <table v-if="report.ai.agents.length" class="table op-table">
            <thead><tr><th>Agent</th><th>Tier</th><th>Calls</th><th>Resolved</th><th>Escalated</th><th>Signals</th></tr></thead>
            <tbody>
              <tr v-for="a in report.ai.agents" :key="a.agentId">
                <td class="op-route">{{ a.name }}</td>
                <td><span class="chip" :class="a.tier === 'managed' ? '' : 'chip--ok'">{{ a.tier === 'managed' ? 'Managed' : 'Own keys' }}</span></td>
                <td class="mono">{{ a.calls }}</td>
                <td class="mono">{{ a.resolvedPct }}%</td>
                <td class="mono">{{ a.escalationPct }}% <span class="muted">({{ a.escalated }})</span></td>
                <td class="op-signals"><span v-if="a.flag" class="chip chip--missed op-sig">{{ a.flag }}</span><span v-else class="muted">—</span></td>
              </tr>
            </tbody>
          </table>
          <EmptyState v-else icon="ai" title="No AI activity yet" description="Once your agents answer calls, performance shows here." />
        </div>
        <div class="card op-provider">
          <div class="card-head"><span class="card-title">AI consumption</span></div>
          <div class="op-note">What your agents consumed. On your own keys you're billed by each provider directly — shown for visibility. Managed calls show Telroi's tracked cost.</div>
          <div class="op-summary op-usage-tiles">
            <div class="stat"><div class="stat-label">Calls</div><div class="stat-value">{{ report.ai.totals.calls }}</div></div>
            <div class="stat"><div class="stat-label">STT minutes</div><div class="stat-value">{{ report.ai.totals.sttMinutes }}</div></div>
            <div class="stat"><div class="stat-label">LLM tokens</div><div class="stat-value">{{ fmtTok(report.ai.totals.llmTokens) }}</div></div>
            <div class="stat"><div class="stat-label">TTS chars</div><div class="stat-value">{{ fmtTok(report.ai.totals.ttsChars) }}</div></div>
            <div v-if="report.ai.totals.costUsd > 0" class="stat"><div class="stat-label">Managed cost</div><div class="stat-value">${{ report.ai.totals.costUsd.toFixed(2) }}</div></div>
          </div>
          <table v-if="report.ai.consumption.length" class="table op-table">
            <thead><tr><th>Agent</th><th>Calls</th><th>STT min</th><th>LLM tokens</th><th>TTS chars</th><th v-if="report.ai.totals.costUsd > 0">Cost</th></tr></thead>
            <tbody>
              <tr v-for="r in report.ai.consumption" :key="r.agentId || 'unassigned'">
                <td class="op-route">{{ r.agentName }}<span v-if="r.managed" class="op-tag-managed">managed</span></td>
                <td class="mono">{{ r.calls }}</td>
                <td class="mono">{{ r.sttMinutes }}</td>
                <td class="mono">{{ fmtTok(r.llmTokens) }}</td>
                <td class="mono">{{ fmtTok(r.ttsChars) }}</td>
                <td v-if="report.ai.totals.costUsd > 0" class="mono">{{ r.costUsd > 0 ? '$' + r.costUsd.toFixed(2) : '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div v-show="tab === 'fraud'">
        <div class="card op-provider">
          <div class="card-head"><span class="card-title">Fraud &amp; anomalies</span><span class="chip" :class="report.fraud.length ? 'chip--missed' : 'chip--ok'">{{ report.fraud.length ? report.fraud.length + ' alert' + (report.fraud.length === 1 ? '' : 's') : 'All clear' }}</span></div>
          <div class="op-note">Live detection across both inbound and outbound traffic: outbound IRSF (premium-rate destinations), traffic pumping and call velocity; inbound floods, toll-fraud probing and callback-bait patterns. Runs on your call records — SIP registration-level detection (auth failures, unexpected source IPs) is coming next. Heuristic signals — review before acting.</div>
          <table v-if="report.fraud.length" class="table op-table">
            <thead><tr><th>Severity</th><th>Type</th><th>Detail</th><th>Calls</th></tr></thead>
            <tbody>
              <tr v-for="(f, i) in report.fraud" :key="i">
                <td><span class="chip" :class="f.severity === 'high' ? 'chip--missed' : f.severity === 'medium' ? 'chip--warn' : ''">{{ f.severity }}</span></td>
                <td class="op-route">{{ f.kind }}</td>
                <td>{{ f.detail }}</td>
                <td class="mono">{{ f.calls }}</td>
              </tr>
            </tbody>
          </table>
          <EmptyState v-else icon="quality" title="No anomalies detected" description="No IRSF, traffic-pumping or velocity anomalies in the selected period." />
        </div>
      </div>
    </template>

    <div v-else class="card"><EmptyState icon="quality" title="No data yet" description="Once calls flow through your account, optimization intelligence appears here." /></div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';

const props = withDefaults(defineProps<{ apiBase?: string }>(), { apiBase: '/api/optimize' });
const api = useApi();
const toast = useToast();

const pending = ref(true);
const report = ref<any>(null);
const period = ref('month');
const tab = ref('overview');

const tabs = computed(() => [
  { key: 'overview', label: 'Overview', badge: null },
  { key: 'routes', label: 'Routes', badge: report.value?.overview.routesAtRisk ?? null },
  { key: 'ai', label: 'AI', badge: null },
  { key: 'fraud', label: 'Fraud', badge: report.value?.overview.fraudAlerts ?? null }
]);

const worstRoutes = computed(() => (report.value?.routes || []).slice(0, 5));

function scoreColor(s: number | null) {
  if (s == null) return '';
  if (s >= 75) return 'color:var(--ok, #1d9e75)';
  if (s >= 60) return 'color:#c8962e';
  return 'color:var(--danger, #d64545)';
}
function fmtTok(n: number) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  return String(n || 0);
}

async function load() {
  pending.value = true;
  try {
    report.value = await api.get<any>(props.apiBase, { period: period.value });
  } catch (e: any) { toast.err(e.message); }
  finally { pending.value = false; }
}

function csv(v: any) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function downloadReport() {
  if (!report.value) return;
  const r = report.value;
  const lines = [];
  lines.push('Telroi Optimize report,' + new Date().toISOString());
  lines.push('Period,' + r.period);
  lines.push('');
  lines.push('OVERVIEW');
  lines.push('Estate score,' + (r.overview.avgScore ?? ''));
  lines.push('Total calls,' + r.overview.totalCalls);
  lines.push('Answer rate %,' + r.overview.answerRate);
  lines.push('Routes at risk,' + r.overview.routesAtRisk);
  lines.push('AI calls,' + r.overview.aiCalls);
  lines.push('AI resolved %,' + r.overview.aiResolvedPct);
  lines.push('Fraud alerts,' + r.overview.fraudAlerts);
  lines.push('');
  lines.push('ROUTES');
  lines.push('Route,Carrier,Direction,Calls,Score,Grade,Answer %,Avg wait s,Avg dur s,Rating,Signals');
  for (const rt of r.routes) lines.push([rt.label, rt.carrier, rt.direction, rt.calls, rt.score, rt.grade, rt.answerRate, rt.avgWaitSec ?? '', rt.avgDurationSec ?? '', rt.avgRating ?? '', (rt.signals || []).join('; ')].map(csv).join(','));
  lines.push('');
  lines.push('AI PERFORMANCE');
  lines.push('Agent,Tier,Calls,Resolved %,Escalated %,Flag');
  for (const a of r.ai.agents) lines.push([a.name, a.tier, a.calls, a.resolvedPct, a.escalationPct, a.flag ?? ''].map(csv).join(','));
  lines.push('');
  lines.push('AI CONSUMPTION');
  lines.push('Agent,Calls,STT min,LLM tokens,TTS chars,Cost USD');
  for (const c of r.ai.consumption) lines.push([c.agentName, c.calls, c.sttMinutes, c.llmTokens, c.ttsChars, c.costUsd].map(csv).join(','));
  lines.push('');
  lines.push('FRAUD & ANOMALIES');
  lines.push('Severity,Type,Detail,Calls');
  for (const f of r.fraud) lines.push([f.severity, f.kind, f.detail, f.calls].map(csv).join(','));
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'telroi-optimize-' + r.period + '-' + new Date().toISOString().slice(0, 10) + '.csv';
  a.click();
  URL.revokeObjectURL(url);
}

onMounted(load);
</script>

<style scoped>
.op-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }
.op-controls { display: flex; gap: 8px; align-items: center; }
.op-period { min-width: 130px; }
.op-tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--rule); margin-bottom: 22px; }
.op-tab { padding: 10px 16px; font-size: 14px; font-weight: 500; color: var(--ink-mute, #8a8f98); border-bottom: 2px solid transparent; margin-bottom: -1px; background: none; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; }
.op-tab:hover { color: var(--ink-soft, #cfd3da); }
.op-tab.on { color: var(--ink, #fff); border-bottom-color: #7d8cff; }
.op-tab-badge { background: var(--danger, #d64545); color: #fff; font-size: 11px; font-weight: 600; padding: 1px 7px; border-radius: 10px; }
.op-loading { display: flex; flex-direction: column; gap: 10px; }
.op-summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 14px; margin-bottom: 22px; }
.op-usage-tiles { margin: 14px 0; }
.stat { background: var(--paper, rgba(255,255,255,0.02)); border: 1px solid var(--rule); border-radius: var(--radius, 12px); padding: 16px; }
.stat-label { font-size: 12px; color: var(--ink-mute, #8a8f98); margin-bottom: 6px; }
.stat-value { font-size: 30px; font-weight: 600; line-height: 1; }
.stat-value .unit { font-size: 14px; color: var(--ink-mute, #8a8f98); margin-left: 2px; }
.stat-meta { font-size: 12px; color: var(--ink-mute, #8a8f98); margin-top: 6px; }
.op-overview-cols { display: grid; grid-template-columns: 1.4fr 1fr; gap: 16px; }
.op-mini { padding: 0; }
.op-link { background: none; border: none; color: #7d8cff; font-size: 13px; cursor: pointer; }
.op-ai-glance { padding: 8px 20px 18px; }
.op-glance-row { display: flex; justify-content: space-between; padding: 9px 0; border-bottom: 1px solid var(--rule); font-size: 14px; }
.op-glance-row:last-child { border-bottom: none; }
.op-glance-row span { color: var(--ink-mute, #8a8f98); }
.op-provider { margin-bottom: 18px; }
.op-legend { display: flex; flex-wrap: wrap; gap: 16px; padding: 0 20px 14px; font-size: 12px; color: var(--ink-mute, #8a8f98); }
.op-leg { display: inline-flex; align-items: center; gap: 6px; }
.op-note { padding: 4px 20px 16px; font-size: 13px; color: var(--ink-mute, #8a8f98); line-height: 1.6; max-width: 720px; }
.op-table { width: 100%; }
.op-route { font-weight: 500; }
.op-dir { font-weight: 400; font-size: 12px; }
.op-score { color: var(--ink-mute, #8a8f98); }
.op-grade { display: inline-block; width: 22px; height: 22px; line-height: 22px; text-align: center; border-radius: 6px; font-weight: 700; font-size: 12px; }
.g-A { background: rgba(29,158,117,0.16); color: #1d9e75; }
.g-B { background: rgba(29,158,117,0.12); color: #3cb98e; }
.g-C { background: rgba(200,150,46,0.16); color: #c8962e; }
.g-D { background: rgba(214,69,69,0.14); color: #d64545; }
.g-F { background: rgba(214,69,69,0.2); color: #d64545; }
.op-signals { display: flex; flex-wrap: wrap; gap: 4px; }
.op-sig { font-size: 11px; }
.op-tag-managed { font-size: 11px; color: var(--ink-mute, #8a8f98); margin-left: 8px; padding: 1px 7px; border: 1px solid var(--rule); border-radius: 8px; }
.op-foot { padding: 10px 20px 4px; font-size: 12px; }
.chip--warn { background: rgba(200,150,46,0.16); color: #c8962e; }
@media (max-width: 860px) {
  .op-overview-cols { grid-template-columns: 1fr; }
  .op-head { flex-direction: column; }
}
</style>
