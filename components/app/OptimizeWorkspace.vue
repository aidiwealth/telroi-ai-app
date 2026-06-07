<template>
  <div>
    <div class="page-head op-head">
      <div>
        <h1 class="page-title">Optimize</h1>
        <p class="page-sub">Call-quality intelligence across every route. Scored on what each route actually reports — operational metrics from Telroi, plus carrier-grade audio metrics where available.</p>
      </div>
      <select v-model="period" class="select op-period" @change="load">
        <option value="week">This week</option>
        <option value="month">This month</option>
      </select>
    </div>

    <!-- Summary tiles -->
    <div class="op-summary" v-if="!pending && summary">
      <div class="stat">
        <div class="stat-label">Estate score</div>
        <div class="stat-value" :style="scoreColor(summary.avgScore)">{{ summary.avgScore ?? '—' }}<span class="unit" v-if="summary.avgScore != null">/100</span></div>
        <div class="stat-meta">Across {{ summary.totalRoutes }} routes</div>
      </div>
      <div class="stat">
        <div class="stat-label">Routes at risk</div>
        <div class="stat-value" :style="summary.atRisk ? 'color:var(--danger)' : ''">{{ summary.atRisk }}</div>
        <div class="stat-meta">Grade D or F</div>
      </div>
      <div class="stat">
        <div class="stat-label">Carrier-grade data</div>
        <div class="stat-value" style="font-size:22px">{{ summary.hasCarrierGrade ? 'Live' : 'Partial' }}</div>
        <div class="stat-meta">{{ summary.hasCarrierGrade ? 'MOS / jitter available' : 'Operational only' }}</div>
      </div>
    </div>

    <div v-if="pending" class="op-loading"><div v-for="i in 3" :key="i" class="skeleton skel-row" /></div>

    <!-- Per-provider sections -->
    <div v-else>
      <div v-for="r in results" :key="r.provider" class="card op-provider">
        <div class="card-head">
          <span class="card-title">{{ providerLabel(r.provider) }}</span>
          <span class="chip" :class="r.hasCarrierGrade ? 'chip--ok' : ''">{{ r.hasCarrierGrade ? 'Carrier-grade' : 'Operational' }}</span>
        </div>
        <div v-if="r.note" class="op-note">{{ r.note }}</div>
        <table v-if="r.metrics.length" class="table op-table">
          <thead>
            <tr>
              <th>Route</th><th>Calls</th><th>Score</th>
              <th>Answer</th><th>Wait</th><th>Rating</th>
              <th>MOS</th><th>Jitter</th><th>Loss</th><th>Signals</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="m in r.metrics" :key="m.scope">
              <td class="op-route">{{ m.label }}</td>
              <td class="mono">{{ m.calls }}</td>
              <td><span class="op-grade" :class="`g-${m.grade}`">{{ m.grade }}</span> <span class="mono op-score">{{ m.score }}</span></td>
              <td class="mono">{{ fmt(m.answerRate, '%') }}</td>
              <td class="mono">{{ fmt(m.avgWaitSec, 's') }}</td>
              <td class="mono">{{ m.avgRating != null ? m.avgRating + '★' : '—' }}</td>
              <td class="mono" :class="mosClass(m.mos)">{{ m.mos ?? naSpan }}</td>
              <td class="mono">{{ fmt(m.jitterMs, 'ms') }}</td>
              <td class="mono">{{ fmt(m.packetLossPct, '%') }}</td>
              <td class="op-signals">
                <span v-for="sig in m.signals" :key="sig" class="chip chip--missed op-sig">{{ sig }}</span>
                <span v-if="!m.signals.length" class="muted">—</span>
              </td>
            </tr>
          </tbody>
        </table>
        <EmptyState v-else icon="quality" title="No data for this provider" description="No quality data in the selected period — try a wider range." />
      </div>

      <div v-if="!results.length" class="card"><EmptyState icon="quality" title="No quality data yet"
        description="Once calls start flowing through Telroi, route scoring will appear here." /></div>
    </div>

    <p class="op-foot muted">Metrics shown <em>na</em> are not reported by that provider — Telroi's API doesn't expose audio-level data (MOS, jitter, packet loss). Carrier-grade scoring depends on the carrier the number runs on.</p>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';

const props = withDefaults(defineProps<{ apiBase?: string }>(), { apiBase: '/api/optimize' });
const api = useApi();
const toast = useToast();

const pending = ref(true);
const summary = ref<any>(null);
const results = ref<any[]>([]);
const period = ref('month');
const naSpan = 'na';

function providerLabel(p: string) { return ({ telroi: 'Telroi', twilio: 'Carrier-grade route', telnyx: 'Carrier-grade route' } as any)[p] || 'Carrier route'; }
function fmt(v: number | null, unit: string) { return v == null ? 'na' : `${v}${unit}`; }
function mosClass(v: number | null) { return v == null ? 'op-na' : v < 3.5 ? 'op-bad' : 'op-good'; }
function scoreColor(s: number | null) {
  if (s == null) return '';
  return s >= 75 ? 'color:#0a8a5c' : s >= 60 ? '' : 'color:var(--danger)';
}

async function load() {
  pending.value = true;
  try {
    const data = await api.get<any>(props.apiBase, { period: period.value });
    summary.value = data.summary;
    results.value = data.results || [];
  } catch (e: any) { toast.err(e.message); }
  finally { pending.value = false; }
}

onMounted(load);
</script>

<style scoped>
.op-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; }
.op-period { width: 150px; }
.op-summary { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 24px; }
.stat-value .unit { font-size: 16px; color: var(--ink-mute); }
.op-loading { display: flex; flex-direction: column; gap: 12px; }
.skel-row { height: 80px; }

.op-provider { margin-bottom: 20px; overflow: hidden; }
.op-note { padding: 12px 24px; background: var(--signal-soft); color: var(--signal-2); font-size: 12.5px; line-height: 1.5; border-bottom: 1px solid var(--rule-2); }
.op-table { font-size: 13px; }
.op-table th { font-size: 10px; padding: 10px 12px; }
.op-table td { padding: 11px 12px; }
.op-route { font-weight: 500; }
.op-grade { display: inline-block; width: 22px; height: 22px; line-height: 22px; text-align: center; border-radius: 6px; font-weight: 700; font-size: 12px; margin-right: 6px; }
.g-A { background: rgba(0,210,138,0.15); color: #0a8a5c; }
.g-B { background: rgba(0,210,138,0.1); color: #0a8a5c; }
.g-C { background: var(--paper-3); color: var(--ink-soft); }
.g-D { background: rgba(183,121,31,0.12); color: var(--warn); }
.g-F { background: rgba(192,57,43,0.1); color: var(--danger); }
.op-score { color: var(--ink-soft); }
.op-na, .op-table .mono:empty::after { color: var(--ink-mute); }
.op-bad { color: var(--danger); }
.op-good { color: #0a8a5c; }
.op-signals { max-width: 200px; }
.op-sig { font-size: 10.5px; margin: 1px; }
.op-empty { padding: 30px; }
.op-foot { font-size: 12px; margin-top: 8px; line-height: 1.5; }
.op-foot em { font-family: var(--font-mono); font-style: normal; background: var(--paper-3); padding: 0 4px; border-radius: 3px; }
.inline-link { color: var(--signal); }

@media (max-width: 820px) {
  .op-summary { grid-template-columns: 1fr; }
  .op-table { display: block; overflow-x: auto; }
}
</style>
