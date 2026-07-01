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
        <thead><tr><th>Agent</th><th>Running on</th><th>Greeting</th><th></th></tr></thead>
        <tbody>
          <tr v-for="a in agents" :key="a.id">
            <td><span class="prov-name">{{ a.name }}</span></td>
            <td>
              <div class="tier-badges">
                <span class="tier" :class="tierClass(a.tier?.llm)" :title="tierTitle('LLM', a.tier?.llm)">LLM: {{ tierLabel(a.tier?.llm) }}</span>
                <span class="tier" :class="tierClass(a.tier?.stt)" :title="tierTitle('Speech-to-text', a.tier?.stt)">STT: {{ tierLabel(a.tier?.stt) }}</span>
                <span class="tier" :class="tierClass(a.tier?.tts)" :title="tierTitle('Text-to-speech', a.tier?.tts)">TTS: {{ tierLabel(a.tier?.tts) }}</span>
              </div>
              <span v-if="a.tier?.anyManaged" class="tier-note">Managed = billed via Telroi. Add your own key under Connections to switch to your account.</span>
            </td>
            <td class="muted">{{ a.greeting || '—' }}</td>
            <td class="row-actions"><button class="btn btn-danger btn-sm" @click="removeAgent(a.id)">Remove</button></td>
          </tr>
        </tbody>
      </table>
      <EmptyState v-else icon="ai" title="No voice agents yet" description="Create an agent, then bind it to a Virtual AI Number to answer calls." />
    </div>

  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue';

const props = withDefaults(defineProps<{ apiBase?: string; agentsBase?: string }>(), { apiBase: '/api/ai/connections', agentsBase: '/api/agents' });
const api = useApi();
const toast = useToast();

interface Conn { id: string; provider: string; keyMasked: string; status: string; lastTestedAt: string | null; }
interface AgentTier { llm: string; stt: string; tts: string; anyManaged: boolean; }
interface Agent { id: string; name: string; greeting?: string | null; tier?: AgentTier; }
function tierLabel(t?: string): string { return t === 'byok' ? 'Your key' : t === 'managed' ? 'Managed' : 'Not set'; }
function tierClass(t?: string): string { return t === 'byok' ? 'tier-byok' : t === 'managed' ? 'tier-managed' : 'tier-none'; }
function tierTitle(role: string, t?: string): string {
  if (t === 'byok') return `${role} runs on your own provider key — billed directly by the provider.`;
  if (t === 'managed') return `${role} runs on Telroi's managed key — usage is billed to your Telroi account.`;
  return `${role} has no working provider configured.`;
}

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

onMounted(() => { load(); loadAgents(); });
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

@media (max-width: 820px) {
  .add-grid { grid-template-columns: 1fr; }
  .prov-guide { grid-template-columns: 1fr 1fr; }
}
.tier-badges { display: flex; flex-wrap: wrap; gap: 6px; }
.tier { font-size: 11px; padding: 2px 7px; border-radius: 6px; font-weight: 550; white-space: nowrap; }
.tier-byok { background: rgba(80,200,140,0.14); color: #62d29a; }
.tier-managed { background: rgba(255,180,90,0.16); color: #ffb45a; }
.tier-none { background: rgba(150,150,160,0.14); color: #9aa0aa; }
.tier-note { display: block; margin-top: 6px; font-size: 11px; color: var(--text-muted, #8a8f98); max-width: 340px; }
</style>
