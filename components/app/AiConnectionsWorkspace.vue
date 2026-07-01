<template>
  <div>
    <div class="page-head">
      <h1 class="page-title">AI</h1>
      <p class="page-sub">Connect your own AI provider keys. You're billed directly by each provider — Telroi never marks up or charges for model usage.</p>
    </div>

    <!-- Connections -->
    <div class="card ai-card">
      <div class="card-head">
        <span class="card-title">Your connections</span>
        <button class="btn btn-signal btn-sm" @click="showAdd = !showAdd">{{ showAdd ? 'Cancel' : '+ Add key' }}</button>
      </div>

      <!-- Add form -->
      <Transition name="expand">
        <div v-if="showAdd" class="add-form">
          <div class="add-grid">
            <select v-model="draft.provider" class="select">
              <option v-for="p in providers" :key="p.id" :value="p.id">{{ p.label }}</option>
            </select>
            <input v-model="draft.apiKey" class="input mono" type="password" placeholder="API key" @keyup.enter="add" />
            <button class="btn btn-dark" :disabled="adding || draft.apiKey.length < 8" @click="add">{{ adding ? 'Saving…' : 'Save' }}</button>
          </div>
          <p class="add-note muted">Keys are encrypted at rest (AES-256-GCM) and never displayed again.</p>
        </div>
      </Transition>

      <div v-if="pending" class="loading-pad">
        <div v-for="i in 3" :key="i" class="skeleton skel-row" />
      </div>
      <table v-else-if="connections.length" class="table">
        <thead><tr><th>Provider</th><th>Key</th><th>Status</th><th>Last tested</th><th></th></tr></thead>
        <tbody>
          <tr v-for="c in connections" :key="c.id">
            <td><span class="prov-name">{{ label(c.provider) }}</span></td>
            <td class="mono">{{ c.keyMasked }}</td>
            <td>
              <span class="chip" :class="c.status === 'ok' ? 'chip--ok' : c.status === 'failed' ? 'chip--missed' : ''">
                {{ c.status === 'ok' ? 'Working' : c.status === 'failed' ? 'Failed' : 'Untested' }}
              </span>
            </td>
            <td class="muted">{{ c.lastTestedAt ? fmtTime(c.lastTestedAt) : '—' }}</td>
            <td class="row-actions">
              <button class="btn btn-ghost btn-sm" :disabled="testing === c.id" @click="test(c.id)">{{ testing === c.id ? 'Testing…' : 'Test' }}</button>
              <button class="btn btn-danger btn-sm" @click="remove(c.id)">Remove</button>
            </td>
          </tr>
        </tbody>
      </table>
      <EmptyState v-else icon="ai" title="No AI connected" description="Add a provider key to power transcription, voice agents and call intelligence." />
    </div>

    <!-- Provider guide -->
    <div class="prov-guide">
      <div v-for="p in providers" :key="p.id" class="guide-tile">
        <div class="guide-name">{{ p.label }}</div>
        <div class="guide-role">{{ p.role }}</div>
      </div>
    </div>

    <!-- Voice agents — real data -->
    <div class="card agent-card">
      <div class="card-head">
        <span class="card-title">Voice agents</span>
        <button class="btn btn-signal btn-sm" @click="showAgent = !showAgent">{{ showAgent ? 'Cancel' : '+ New agent' }}</button>
      </div>

      <Transition name="expand">
        <div v-if="showAgent" class="add-form">
          <div class="add-grid">
            <input v-model="agentDraft.name" class="input" placeholder="Agent name (e.g. Support agent)" @keyup.enter="createAgent" />
            <input v-model="agentDraft.greeting" class="input" placeholder="Greeting (optional)" @keyup.enter="createAgent" />
            <button class="btn btn-dark" :disabled="savingAgent || !agentDraft.name.trim()" @click="createAgent">{{ savingAgent ? 'Saving…' : 'Create' }}</button>
          </div>
        </div>
      </Transition>

      <div v-if="agentsPending" class="loading-pad"><div v-for="i in 2" :key="i" class="skeleton skel-row" /></div>
      <table v-else-if="agents.length" class="table">
        <thead><tr><th>Agent</th><th>Greeting</th><th></th></tr></thead>
        <tbody>
          <tr v-for="a in agents" :key="a.id">
            <td><span class="prov-name">{{ a.name }}</span></td>
            <td class="muted">{{ a.greeting || '—' }}</td>
            <td class="row-actions"><button class="btn btn-danger btn-sm" @click="removeAgent(a.id)">Remove</button></td>
          </tr>
        </tbody>
      </table>
      <EmptyState v-else icon="ai" title="No voice agents yet" description="Create an agent, then bind it to a Virtual AI Number to answer calls." />
    </div>

    <!-- Usage -->
    <div class="card">
      <div class="card-head">
        <div>
          <h2 class="card-title">Usage</h2>
          <p class="muted" style="font-size:13px">What your voice agents have consumed. On your own keys you're billed directly by each provider; these figures are for your visibility.</p>
        </div>
        <select v-model.number="usageDays" class="select select-sm" @change="loadUsage">
          <option :value="7">Last 7 days</option>
          <option :value="30">Last 30 days</option>
          <option :value="90">Last 90 days</option>
        </select>
      </div>
      <div v-if="usagePending" class="loading-pad"><div v-for="i in 2" :key="i" class="skeleton skel-row" /></div>
      <template v-else-if="usage && usage.byAgent.length">
        <div class="usage-totals">
          <div class="usage-stat"><span class="usage-num">{{ usage.total.calls }}</span><span class="usage-lbl">Calls</span></div>
          <div class="usage-stat"><span class="usage-num">{{ usage.total.sttMinutes }}</span><span class="usage-lbl">STT minutes</span></div>
          <div class="usage-stat"><span class="usage-num">{{ fmtTok(usage.total.llmInputTokens + usage.total.llmOutputTokens) }}</span><span class="usage-lbl">LLM tokens</span></div>
          <div class="usage-stat"><span class="usage-num">{{ fmtTok(usage.total.ttsChars) }}</span><span class="usage-lbl">TTS characters</span></div>
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
import { ref, reactive, onMounted } from 'vue';

const props = withDefaults(defineProps<{ apiBase?: string; agentsBase?: string }>(), { apiBase: '/api/ai/connections', agentsBase: '/api/agents' });
const api = useApi();
const toast = useToast();

interface Conn { id: string; provider: string; keyMasked: string; status: string; lastTestedAt: string | null; }
interface Agent { id: string; name: string; greeting?: string | null; }

const providers = [
  { id: 'openai', label: 'OpenAI', role: 'LLM · realtime · TTS' },
  { id: 'anthropic', label: 'Anthropic (Claude)', role: 'LLM reasoning' },
  { id: 'deepgram', label: 'Deepgram', role: 'Speech-to-text' },
  { id: 'elevenlabs', label: 'ElevenLabs', role: 'Text-to-speech' },
  { id: 'vapi', label: 'VAPI', role: 'Agent orchestration' },
  { id: 'google', label: 'Google', role: 'STT · TTS' }
];

const pending = ref(true);
const connections = ref<Conn[]>([]);
const showAdd = ref(false);
const adding = ref(false);
const testing = ref<string | null>(null);
const draft = reactive({ provider: 'openai', apiKey: '' });

// Real voice agents (no placeholder — shows actual agents or a clean empty state).
const agents = ref<Agent[]>([]);
const agentsPending = ref(true);
const showAgent = ref(false);
const savingAgent = ref(false);
const agentDraft = reactive({ name: '', greeting: '' });

async function loadAgents() {
  agentsPending.value = true;
  try { agents.value = await api.get<Agent[]>(props.agentsBase); }
  catch { /* */ }
  finally { agentsPending.value = false; }
}

interface UsageRow { agentId: string | null; agentName: string; calls: number; turns: number; sttMinutes: number; llmInputTokens: number; llmOutputTokens: number; ttsChars: number; managed: boolean; costUsd: number; }
interface UsageResp { days: number; byAgent: UsageRow[]; total: { calls: number; turns: number; sttMinutes: number; llmInputTokens: number; llmOutputTokens: number; ttsChars: number; costUsd: number }; }
const usage = ref<UsageResp | null>(null);
const usagePending = ref(true);
const usageDays = ref(30);
function fmtTok(n: number): string { return n >= 1000 ? (Math.round(n / 100) / 10) + 'k' : String(n); }
async function loadUsage() {
  usagePending.value = true;
  try { usage.value = await api.get<UsageResp>(`/api/voice/ai/usage?days=${usageDays.value}`); }
  catch { /* */ }
  finally { usagePending.value = false; }
}
async function createAgent() {
  if (!agentDraft.name.trim()) return;
  savingAgent.value = true;
  try {
    await api.post(props.agentsBase, { name: agentDraft.name.trim(), greeting: agentDraft.greeting.trim() || undefined });
    agentDraft.name = ''; agentDraft.greeting = ''; showAgent.value = false;
    toast.ok('Agent created');
    await loadAgents();
  } catch (e: any) { toast.err(e.message); }
  finally { savingAgent.value = false; }
}
async function removeAgent(id: string) {
  try { await api.del(`${props.agentsBase}/${id}`); toast.ok('Agent removed'); await loadAgents(); }
  catch (e: any) { toast.err(e.message); }
}

function label(id: string) { return providers.find((p) => p.id === id)?.label || id; }
function fmtTime(iso: string) { return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }

async function load() {
  pending.value = true;
  try { connections.value = await api.get<Conn[]>(props.apiBase); }
  catch (e: any) { toast.err(e.message); }
  finally { pending.value = false; }
}

async function add() {
  adding.value = true;
  try {
    await api.post(props.apiBase, { provider: draft.provider, apiKey: draft.apiKey.trim() });
    draft.apiKey = '';
    showAdd.value = false;
    toast.ok('Key saved securely');
    await load();
  } catch (e: any) { toast.err(e.message); }
  finally { adding.value = false; }
}

async function test(id: string) {
  testing.value = id;
  try {
    const r = await api.post<{ ok: boolean; detail?: string }>(`${props.apiBase}/${id}/test`);
    r.ok ? toast.ok('Key is working') : toast.err(`Test failed${r.detail ? ': ' + r.detail : ''}`);
    await load();
  } catch (e: any) { toast.err(e.message); }
  finally { testing.value = null; }
}

async function remove(id: string) {
  try { await api.del(`${props.apiBase}/${id}`); toast.ok('Removed'); await load(); }
  catch (e: any) { toast.err(e.message); }
}

onMounted(() => { load(); loadAgents(); loadUsage(); });
</script>

<style scoped>
.ai-card { overflow: hidden; margin-bottom: 24px; }
.add-form { padding: 18px 24px; border-bottom: 1px solid var(--rule); background: var(--paper-2); }
.add-grid { display: grid; grid-template-columns: 200px 1fr auto; gap: 12px; }
.add-note { font-size: 12px; margin-top: 10px; }
.prov-name { font-weight: 500; }
.row-actions { display: flex; gap: 8px; justify-content: flex-end; }
.loading-pad { padding: 16px 24px; display: flex; flex-direction: column; gap: 10px; }
.skel-row { height: 20px; }

.prov-guide { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 24px; }
.guide-tile { background: var(--paper); border: 1px solid var(--rule); border-radius: var(--radius); padding: 14px 16px; }
.guide-name { font-size: 13.5px; font-weight: 500; margin-bottom: 3px; }
.guide-role { font-size: 12px; color: var(--ink-mute); }

.expand-enter-active, .expand-leave-active { transition: opacity .18s; }
.expand-enter-from, .expand-leave-to { opacity: 0; }

.usage-totals { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 16px; }
.usage-stat { display: flex; flex-direction: column; gap: 2px; padding: 12px 14px; background: var(--surface-2, rgba(255,255,255,0.03)); border-radius: 10px; }
.usage-num { font-size: 22px; font-weight: 650; line-height: 1; }
.usage-lbl { font-size: 12px; color: var(--text-muted, #8a8f98); }
.tag-managed { margin-left: 8px; font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; padding: 2px 6px; border-radius: 5px; background: rgba(120,140,255,0.15); color: #9db0ff; vertical-align: middle; }
@media (max-width: 820px) {
  .add-grid { grid-template-columns: 1fr; }
  .prov-guide { grid-template-columns: 1fr 1fr; }
  .usage-totals { grid-template-columns: repeat(2, 1fr); }
}
</style>
