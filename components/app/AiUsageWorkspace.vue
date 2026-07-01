<template>
  <div class="stack">
    <div class="page-head">
      <div>
        <h1 class="page-title">AI Usage</h1>
        <p class="page-sub">What your voice agents have consumed. On your own keys you're billed directly by each provider — these figures are for your visibility. Managed-tier calls show the cost Telroi tracks.</p>
      </div>
      <select v-model.number="usageDays" class="select select-sm" @change="loadUsage">
        <option :value="7">Last 7 days</option>
        <option :value="30">Last 30 days</option>
        <option :value="90">Last 90 days</option>
      </select>
    </div>
    <div class="card">
      <div v-if="usagePending" class="loading-pad"><div v-for="i in 3" :key="i" class="skeleton skel-row" /></div>
      <template v-else-if="usage && usage.byAgent.length">
        <div class="usage-totals">
          <div class="usage-stat"><span class="usage-num">{{ usage.total.calls }}</span><span class="usage-lbl">Calls</span></div>
          <div class="usage-stat"><span class="usage-num">{{ usage.total.sttMinutes }}</span><span class="usage-lbl">STT minutes</span></div>
          <div class="usage-stat"><span class="usage-num">{{ fmtTok(usage.total.llmInputTokens + usage.total.llmOutputTokens) }}</span><span class="usage-lbl">LLM tokens</span></div>
          <div class="usage-stat"><span class="usage-num">{{ fmtTok(usage.total.ttsChars) }}</span><span class="usage-lbl">TTS characters</span></div>
          <div v-if="usage.total.costUsd > 0" class="usage-stat"><span class="usage-num">${{ usage.total.costUsd.toFixed(2) }}</span><span class="usage-lbl">Managed cost</span></div>
        </div>
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
      </template>
      <EmptyState v-else icon="ai" title="No usage yet" description="Once your agents start answering calls, consumption shows up here." />
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
.usage-totals { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 12px; margin-bottom: 16px; }
.usage-stat { display: flex; flex-direction: column; gap: 2px; padding: 12px 14px; background: var(--surface-2, rgba(255,255,255,0.03)); border-radius: 10px; }
.usage-num { font-size: 22px; font-weight: 650; line-height: 1; }
.usage-lbl { font-size: 12px; color: var(--text-muted, #8a8f98); }
.tag-managed { margin-left: 8px; font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; padding: 2px 6px; border-radius: 5px; background: rgba(120,140,255,0.15); color: #9db0ff; vertical-align: middle; }
</style>
