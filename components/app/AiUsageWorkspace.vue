<template>
  <div class="stack usage-page">
    <div class="usage-intro">
      <h1 class="page-title">AI Usage</h1>
      <p class="page-sub">What your voice agents have consumed. On your own keys you're billed directly by each provider — these figures are for your visibility. Managed-tier calls show the cost Telroi tracks.</p>
    </div>

    <div class="usage-filter">
      <select v-model.number="usageDays" class="select select-sm" @change="loadUsage">
        <option :value="7">Last 7 days</option>
        <option :value="30">Last 30 days</option>
        <option :value="90">Last 90 days</option>
      </select>
    </div>

    <div v-if="usagePending" class="metric-grid">
      <div v-for="i in 4" :key="i" class="metric-card skeleton" style="height:88px" />
    </div>
    <template v-else-if="usage && usage.byAgent.length">
      <div class="metric-grid">
        <div class="metric-card"><span class="metric-num">{{ usage.total.calls }}</span><span class="metric-lbl">Calls</span></div>
        <div class="metric-card"><span class="metric-num">{{ usage.total.sttMinutes }}</span><span class="metric-lbl">STT minutes</span></div>
        <div class="metric-card"><span class="metric-num">{{ fmtTok(usage.total.llmInputTokens + usage.total.llmOutputTokens) }}</span><span class="metric-lbl">LLM tokens</span></div>
        <div class="metric-card"><span class="metric-num">{{ fmtTok(usage.total.ttsChars) }}</span><span class="metric-lbl">TTS characters</span></div>
        <div v-if="usage.total.costUsd > 0" class="metric-card metric-cost"><span class="metric-num">${{ usage.total.costUsd.toFixed(2) }}</span><span class="metric-lbl">Managed cost</span></div>
      </div>

      <div class="card usage-table-card">
        <h2 class="card-title">By agent</h2>
        <table class="table">
          <thead><tr><th>Agent</th><th>Calls</th><th>STT min</th><th>LLM tokens</th><th>TTS chars</th><th v-if="usage.total.costUsd > 0">Cost</th></tr></thead>
          <tbody>
            <tr v-for="r in usage.byAgent" :key="r.agentId || 'unassigned'">
              <td><span class="prov-name">{{ r.agentName }}</span><span v-if="r.managed" class="tag-managed">managed</span></td>
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
    <div v-else class="card">
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
.usage-intro { margin-bottom: 20px; }
.usage-intro .page-sub { margin-top: 6px; max-width: 640px; }
.usage-filter { margin-bottom: 24px; }
.metric-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 14px; margin-bottom: 28px; }
.metric-card { display: flex; flex-direction: column; gap: 6px; padding: 18px 20px; background: var(--surface-1, rgba(255,255,255,0.04)); border: 1px solid var(--border, rgba(255,255,255,0.08)); border-radius: 14px; }
.metric-num { font-size: 28px; font-weight: 680; line-height: 1.1; }
.metric-lbl { font-size: 13px; color: var(--text-muted, #8a8f98); }
.metric-cost .metric-num { color: #ffb45a; }
.usage-table-card { margin-top: 4px; }
.usage-table-card .card-title { margin-bottom: 14px; }
.tag-managed { margin-left: 8px; font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; padding: 2px 6px; border-radius: 5px; background: rgba(255,180,90,0.16); color: #ffb45a; vertical-align: middle; }
@media (max-width: 640px) { .metric-grid { grid-template-columns: repeat(2, 1fr); } }
</style>
