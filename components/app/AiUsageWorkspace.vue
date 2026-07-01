<template>
  <div class="stack usage-page">
    <div class="usage-intro">
      <h1 class="page-title">AI Usage</h1>
      <p class="page-sub">What your voice agents have consumed. On your own keys you're billed directly by each provider — these figures are for your visibility. Managed-tier calls show the cost Telroi tracks.</p>
    </div>

    <div v-if="usagePending" class="metric-grid">
      <div v-for="i in 4" :key="i" class="metric-card skeleton" style="height:92px" />
    </div>
    <template v-else-if="usage && usage.byAgent.length">
      <div class="metric-grid">
        <div class="metric-card"><span class="metric-num">{{ usage.total.calls }}</span><span class="metric-lbl">Calls</span></div>
        <div class="metric-card"><span class="metric-num">{{ usage.total.sttMinutes }}</span><span class="metric-lbl">STT minutes</span></div>
        <div class="metric-card"><span class="metric-num">{{ fmtTok(usage.total.llmInputTokens + usage.total.llmOutputTokens) }}</span><span class="metric-lbl">LLM tokens</span></div>
        <div class="metric-card"><span class="metric-num">{{ fmtTok(usage.total.ttsChars) }}</span><span class="metric-lbl">TTS characters</span></div>
        <div v-if="usage.total.costUsd > 0" class="metric-card metric-cost"><span class="metric-num">${{ usage.total.costUsd.toFixed(2) }}</span><span class="metric-lbl">Managed cost</span></div>
      </div>

      <div class="usage-filter">
        <span class="filter-label">Showing</span>
        <select v-model.number="usageDays" class="select filter-select" @change="loadUsage">
          <option :value="7">Last 7 days</option>
          <option :value="30">Last 30 days</option>
          <option :value="90">Last 90 days</option>
        </select>
      </div>

      <div class="card">
        <div class="card-head"><h2 class="card-title">By agent</h2></div>
        <table class="table">
          <thead><tr><th>Agent</th><th>Calls</th><th>STT min</th><th>LLM tokens</th><th>TTS chars</th><th v-if="usage.total.costUsd > 0">Cost</th></tr></thead>
          <tbody>
            <tr v-for="r in usage.byAgent" :key="r.agentId || 'unassigned'">
              <td><span class="agent-name">{{ r.agentName }}</span><span v-if="r.managed" class="tag-managed">managed</span></td>
              <td>{{ r.calls }}</td>
              <td>{{ r.sttMinutes }}</td>
              <td>{{ fmtTok(r.llmInputTokens + r.llmOutputTokens) }}</td>
              <td>{{ fmtTok(r.ttsChars) }}</td>
              <td v-if="usage.total.costUsd > 0">{{ r.costUsd > 0 ? '$' + r.costUsd.toFixed(2) : '—' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
    <div v-else class="card card-pad">
      <EmptyState icon="ai" title="No usage yet" description="Once your agents start answering calls, consumption shows up here." />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useApi } from '~/composables/useApi';
const props = defineProps<{ usageBase?: string }>();
const api = useApi();
const base = props.usageBase || '/api/voice/ai/usage';
interface UsageRow { agentId: string | null; agentName: string; calls: number; turns: number; sttMinutes: number; llmInputTokens: number; llmOutputTokens: number; ttsChars: number; managed: boolean; costUsd: number; }
interface UsageResp { days: number; byAgent: UsageRow[]; total: { calls: number; turns: number; sttMinutes: number; llmInputTokens: number; llmOutputTokens: number; ttsChars: number; costUsd: number }; }
const usage = ref<UsageResp | null>(null);
const usagePending = ref(true);
const usageDays = ref(30);
function fmtTok(n: number): string { return n >= 1000 ? (Math.round(n / 100) / 10) + 'k' : String(n); }
async function loadUsage() {
  usagePending.value = true;
  try { usage.value = await api.get<UsageResp>(`${base}?days=${usageDays.value}`); }
  catch { /* */ }
  finally { usagePending.value = false; }
}
onMounted(loadUsage);
</script>

<style scoped>
.usage-page { display: flex; flex-direction: column; }
.usage-intro { margin-bottom: 28px; }
.usage-intro .page-sub { margin-top: 8px; max-width: 640px; }
.metric-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 16px; margin-bottom: 24px; }
.metric-card { display: flex; flex-direction: column; gap: 6px; padding: 20px 22px; background: var(--paper); border: 1px solid var(--rule); border-radius: var(--radius); }
.metric-num { font-family: var(--font-display); font-size: 30px; letter-spacing: -0.02em; line-height: 1.05; }
.metric-lbl { font-size: 13px; color: var(--ink-soft); }
.metric-cost .metric-num { color: #d98a2b; }
.usage-filter { display: flex; align-items: center; gap: 10px; margin-bottom: 18px; }
.filter-label { font-size: 13px; color: var(--ink-soft); }
.filter-select { width: auto; min-width: 150px; padding: 8px 12px; font-size: 13.5px; }
.agent-name { font-weight: 550; color: var(--ink); }
.tag-managed { margin-left: 8px; font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; padding: 2px 7px; border-radius: 5px; background: rgba(217,138,43,0.14); color: #d98a2b; vertical-align: middle; }
@media (max-width: 640px) { .metric-grid { grid-template-columns: repeat(2, 1fr); } }
</style>
