<template>
  <div>
    <div class="page-head">
      <h1 class="page-title">AI</h1>
      <p class="page-sub">Connect your own AI provider keys. You're billed directly by each provider — Telroi never marks up or charges for model usage.</p>
    </div>

    <!-- Provider guide — onboarding help, shown only until the first key is added -->
    <div v-if="!pending && !connections.length" class="prov-guide">
      <div v-for="p in providers" :key="p.id" class="guide-tile">
        <div class="guide-name">{{ p.label }}</div>
        <div class="guide-role">{{ p.role }}</div>
      </div>
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
          <input v-model="draft.model" class="input mono conn-model" :placeholder="'Model (optional) — ' + modelPlaceholder(draft.provider)" @keyup.enter="add" />
          <p class="add-note muted">Keys are encrypted at rest (AES-256-GCM) and never displayed again. Leave model blank to use the provider's recommended default.</p>
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


    <!-- Voice agents — real data -->
    <div class="card agent-card">
      <div class="card-head">
        <span class="card-title">Voice agents</span>
        <button class="btn btn-signal btn-sm" @click="showAgent ? (showAgent = false) : (showAgent = true, resetWizard())">{{ showAgent ? 'Cancel' : '+ New agent' }}</button>
      </div>

      <Transition name="expand">
        <div v-if="showAgent" class="add-form wizard">
          <div v-if="wizardStep === 1" class="wiz-step">
            <div class="wiz-head"><span class="wiz-badge">Step 1 of 2</span><span class="wiz-sub">New voice agent</span></div>
            <p class="wiz-title">How should your AI answer calls?</p>
            <p class="wiz-lead">Both options answer calls the same way. The difference is who runs the AI and how you pay.</p>
            <div class="wiz-tiers">
              <button class="wiz-tier wiz-tier-rec" @click="chooseTier('managed')">
                <div class="wiz-tier-top"><span class="wiz-tier-name">Just works</span><span class="wiz-pill">Recommended</span></div>
                <span class="wiz-tier-desc">Telroi runs everything for you. No accounts to connect, nothing to configure. You're billed per use from your wallet.</span>
              </button>
              <button class="wiz-tier" @click="chooseTier('byok')">
                <div class="wiz-tier-top"><span class="wiz-tier-name">Use my own accounts</span></div>
                <span class="wiz-tier-desc">Connect your own AI provider keys. You're billed by them directly. We'll set the best combination up for you.</span>
              </button>
            </div>
          </div>

          <div v-else-if="wizardStep === 2" class="wiz-step">
            <div class="wiz-head"><span class="wiz-badge">Step 2 of 2</span><span class="wiz-sub">What powers your agent</span></div>
            <p class="wiz-title">Every AI agent has three parts</p>
            <p class="wiz-lead">We've picked a sensible default for each from your connected accounts. Change any of them below — for example, use one provider for all three.</p>
            <div class="wiz-parts">
              <div class="wiz-part wiz-part-ears">
                <svg class="wiz-ico" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8.5a6 6 0 0 1 12 0c0 3-2.5 4-3.5 5.5-.7 1-.5 2.5-1.5 3.2a2.4 2.4 0 0 1-3.7-1.2"/><path d="M9 9a3 3 0 0 1 5.5-1.6"/></svg>
                <div class="wiz-part-role">Ears <span>(STT)</span></div>
                <div class="wiz-part-what">Understands the caller</div>
                <select v-model="roleChoice.stt" class="select wiz-part-sel"><option v-for="o in roleOptions('stt')" :key="o.id" :value="o.id">{{ o.label }}</option><option v-if="!roleOptions('stt').length" disabled value="">Not connected</option></select>
              </div>
              <div class="wiz-part wiz-part-brain">
                <svg class="wiz-ico" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 3.5A2.5 2.5 0 0 0 7 6a2.5 2.5 0 0 0-1.5 4.5A2.5 2.5 0 0 0 7 15a2.5 2.5 0 0 0 2.5 2.5c.8 0 1.5-.4 2-.9V4.4c-.5-.6-1.2-.9-2-.9z"/><path d="M14.5 3.5A2.5 2.5 0 0 1 17 6a2.5 2.5 0 0 1 1.5 4.5A2.5 2.5 0 0 1 17 15a2.5 2.5 0 0 1-2.5 2.5c-.8 0-1.5-.4-2-.9V4.4c.5-.6 1.2-.9 2-.9z"/></svg>
                <div class="wiz-part-role">Brain <span>(LLM)</span></div>
                <div class="wiz-part-what">Decides what to say</div>
                <select v-model="roleChoice.llm" class="select wiz-part-sel"><option v-for="o in roleOptions('llm')" :key="o.id" :value="o.id">{{ o.label }}</option><option v-if="!roleOptions('llm').length" disabled value="">Not connected</option></select>
              </div>
              <div class="wiz-part wiz-part-voice">
                <svg class="wiz-ico" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2.5" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0"/><line x1="12" y1="17.5" x2="12" y2="21"/><line x1="8.5" y1="21" x2="15.5" y2="21"/></svg>
                <div class="wiz-part-role">Voice <span>(TTS)</span></div>
                <div class="wiz-part-what">Speaks the reply</div>
                <select v-model="roleChoice.tts" class="select wiz-part-sel"><option v-for="o in roleOptions('tts')" :key="o.id" :value="o.id">{{ o.label }}</option><option v-if="!roleOptions('tts').length" disabled value="">Not connected</option></select>
              </div>
            </div>
            <button class="wiz-adv-toggle" @click="showAdvanced = !showAdvanced">{{ showAdvanced ? '▾' : '▸' }} Want a specific model?</button>
            <div v-if="showAdvanced" class="wiz-adv"><p class="wiz-adv-hint">Each part uses your provider's recommended model by default. To pin a specific model, set it on the provider under Connections above — every agent using that provider will use it. Pinning a model also protects your agent if a provider retires its default.</p></div>
            <div class="wiz-nav">
              <button class="btn btn-ghost btn-sm" @click="wizardStep = 1">Back</button>
              <button class="btn btn-signal btn-sm" @click="wizardStep = 3">Continue</button>
            </div>
          </div>

          <div v-else class="wiz-step">
            <div class="wiz-head"><span class="wiz-badge">{{ agentDraft.tier === 'managed' ? 'Step 2 of 2' : 'Last step' }}</span><span class="wiz-sub">Name your agent</span></div>
            <p class="wiz-title">Give your agent a name</p>
            <p class="wiz-lead"><template v-if="agentDraft.tier === 'managed'">Runs on Telroi's AI — billed per use from your wallet. No setup needed.</template><template v-else>Runs on your connected accounts — billed by each provider directly.</template></p>
            <div class="add-grid">
              <input v-model="agentDraft.name" class="input" placeholder="Agent name (e.g. Support agent)" @keyup.enter="createAgent" />
              <input v-model="agentDraft.greeting" class="input" placeholder="Greeting (optional)" @keyup.enter="createAgent" />
            </div>
            <div class="wiz-nav">
              <button class="btn btn-ghost btn-sm" @click="wizardStep = agentDraft.tier === 'managed' ? 1 : 2">Back</button>
              <button class="btn btn-dark btn-sm" :disabled="savingAgent || !agentDraft.name.trim()" @click="createAgent">{{ savingAgent ? 'Creating…' : 'Create agent' }}</button>
            </div>
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
  { id: 'openai', label: 'OpenAI', role: 'LLM · STT · TTS' },
  { id: 'anthropic', label: 'Anthropic (Claude)', role: 'LLM reasoning' },
  { id: 'google', label: 'Google (Gemini)', role: 'LLM reasoning' },
  { id: 'grok', label: 'Grok (xAI)', role: 'LLM reasoning' },
  { id: 'deepgram', label: 'Deepgram', role: 'Speech-to-text' },
  { id: 'elevenlabs', label: 'ElevenLabs', role: 'Text-to-speech' }
];

const pending = ref(true);
const connections = ref<Conn[]>([]);
const showAdd = ref(false);
const adding = ref(false);
const testing = ref<string | null>(null);
const draft = reactive({ provider: 'openai', apiKey: '', model: '' });
function modelPlaceholder(provider: string): string {
  switch (provider) {
    case 'openai': return 'default: gpt-4o-mini';
    case 'anthropic': return 'default: claude-haiku-4-5';
    case 'google': return 'default: gemini-2.5-flash';
    case 'grok': return 'default: grok-4.3';
    case 'deepgram': return 'default: nova-2';
    case 'elevenlabs': return 'default: eleven_multilingual_v2';
    default: return 'default';
  }
}

// Real voice agents (no placeholder — shows actual agents or a clean empty state).
const agents = ref<Agent[]>([]);
const agentsPending = ref(true);
const showAgent = ref(false);
const savingAgent = ref(false);
const agentDraft = reactive({ name: '', greeting: '', tier: 'byok' as 'byok' | 'managed' });

// Guided setup wizard. Step 1 = tier choice, step 2 = the three parts (BYOK only), then name.
const wizardStep = ref(1);
const showAdvanced = ref(false);
// BYOK: which provider the client chose for each role. '' = use our auto-pick.
const roleChoice = reactive({ stt: '', llm: '', tts: '' });
// Map a role's chosen (or auto) provider to a concrete connection id to send.
function roleConnId(role: 'stt' | 'llm' | 'tts'): string | undefined {
  const provider = roleChoice[role] || roleProvider(role)?.id;
  if (!provider) return undefined;
  const conn = connections.value.find((x) => x.provider === provider && x.status === 'ok');
  return conn?.id;
}
const ROLE_PREF = { stt: ['deepgram', 'openai', 'google'], llm: ['anthropic', 'openai', 'google', 'grok'], tts: ['elevenlabs', 'openai', 'google'] };
function connectedOk(provider: string): boolean { return connections.value.some((c) => c.provider === provider && c.status === 'ok'); }
function roleProvider(role: 'stt' | 'llm' | 'tts'): { id: string; label: string } | null {
  for (const p of ROLE_PREF[role]) { if (connectedOk(p)) return { id: p, label: label(p) }; }
  return null;
}
function roleOptions(role: 'stt' | 'llm' | 'tts'): { id: string; label: string }[] {
  return ROLE_PREF[role].filter(connectedOk).map((p) => ({ id: p, label: label(p) }));
}
function resetWizard() {
  wizardStep.value = 1; showAdvanced.value = false;
  agentDraft.name = ''; agentDraft.greeting = ''; agentDraft.tier = 'byok';
  roleChoice.stt = ''; roleChoice.llm = ''; roleChoice.tts = '';
}
function chooseTier(t: 'byok' | 'managed') {
  agentDraft.tier = t;
  if (t === 'byok') {
    roleChoice.stt = roleProvider('stt')?.id || '';
    roleChoice.llm = roleProvider('llm')?.id || '';
    roleChoice.tts = roleProvider('tts')?.id || '';
  }
  wizardStep.value = t === 'managed' ? 3 : 2;
}

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
    const abody: any = { name: agentDraft.name.trim(), greeting: agentDraft.greeting.trim() || undefined, tier: agentDraft.tier };
    if (agentDraft.tier === 'byok') {
      const stt = roleConnId('stt'); const llm = roleConnId('llm'); const tts = roleConnId('tts');
      if (stt) abody.sttConnId = stt;
      if (llm) abody.llmConnId = llm;
      if (tts) abody.ttsConnId = tts;
    }
    await api.post(props.agentsBase, abody);
    showAgent.value = false; resetWizard();
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
    const cbody: any = { provider: draft.provider, apiKey: draft.apiKey.trim() };
    if (draft.model.trim()) cbody.model = draft.model.trim();
    await api.post(props.apiBase, cbody);
    draft.apiKey = ''; draft.model = '';
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
.conn-model { margin-top: 12px; width: 100%; }
.wizard { padding: 20px 24px; }
.wiz-head { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
.wiz-badge { background: rgba(125,140,255,0.12); color: #7d8cff; font-size: 12px; font-weight: 600; padding: 3px 10px; border-radius: 8px; }
.wiz-sub { font-size: 13px; color: var(--text-muted, #8a8f98); }
.wiz-title { font-size: 18px; font-weight: 600; margin: 0 0 4px; }
.wiz-lead { font-size: 14px; color: var(--text-muted, #8a8f98); margin: 0 0 16px; line-height: 1.5; }
.wiz-tiers { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12px; }
.wiz-tier { text-align: left; padding: 16px; border: 1px solid var(--border, rgba(255,255,255,0.1)); border-radius: 12px; background: var(--paper, rgba(255,255,255,0.02)); cursor: pointer; transition: border-color .15s, background .15s; }
.wiz-tier:hover { border-color: #7d8cff; background: rgba(125,140,255,0.05); }
.wiz-tier-rec { border-color: #7d8cff; border-width: 2px; }
.wiz-tier-top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
.wiz-tier-name { font-weight: 600; font-size: 15px; }
.wiz-pill { background: rgba(125,140,255,0.12); color: #7d8cff; font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 8px; }
.wiz-tier-desc { display: block; font-size: 13px; color: var(--text-muted, #8a8f98); line-height: 1.5; }
.wiz-parts { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin-bottom: 14px; }
.wiz-part { border-radius: 12px; padding: 14px; text-align: center; border: 1px solid var(--border, rgba(255,255,255,0.08)); }
.wiz-ico { width: 40px; height: 40px; margin: 0 auto 8px; display: block; }
.wiz-part-ears .wiz-ico { color: #1d9e75; }
.wiz-part-brain .wiz-ico { color: #7d8cff; }
.wiz-part-voice .wiz-ico { color: #e0a458; }
.wiz-part-ears { background: rgba(29,158,117,0.08); }
.wiz-part-brain { background: rgba(125,140,255,0.08); }
.wiz-part-voice { background: rgba(239,159,39,0.08); }
.wiz-part-role { font-weight: 600; font-size: 14px; }
.wiz-part-role span { font-weight: 400; font-size: 12px; color: var(--text-muted, #8a8f98); }
.wiz-part-what { font-size: 12px; color: var(--text-muted, #8a8f98); margin: 3px 0 8px; }
.wiz-part-prov { font-size: 12px; font-weight: 500; padding: 3px 10px; border-radius: 20px; background: var(--paper-2, rgba(255,255,255,0.04)); display: inline-block; }
.wiz-part-sel { width: 100%; font-size: 13px; text-align: center; text-align-last: center; }
.wiz-part-missing { color: #e0a458; }
.wiz-adv-toggle { background: none; border: none; color: #7d8cff; font-size: 13px; cursor: pointer; padding: 6px 0; }
.wiz-adv { padding: 10px 0 4px; }
.wiz-adv-hint { font-size: 12px; color: var(--text-muted, #8a8f98); line-height: 1.5; margin: 0; }
.wiz-nav { display: flex; justify-content: space-between; gap: 10px; margin-top: 16px; }
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
.tier-choice { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 12px; }
.tier-opt { display: flex; gap: 10px; align-items: flex-start; padding: 12px 14px; border: 1px solid var(--border, rgba(255,255,255,0.1)); border-radius: 12px; cursor: pointer; transition: border-color .15s, background .15s; }
.tier-opt-active { border-color: #7d8cff; background: rgba(125,140,255,0.06); }
.tier-opt input { margin-top: 3px; }
.tier-opt-title { display: block; font-weight: 600; font-size: 14px; }
.tier-opt-sub { display: block; font-size: 12px; color: var(--text-muted, #8a8f98); margin-top: 3px; line-height: 1.4; }
.tier { font-size: 11px; padding: 2px 7px; border-radius: 6px; font-weight: 550; white-space: nowrap; }
.tier-byok { background: rgba(80,200,140,0.14); color: #62d29a; }
.tier-managed { background: rgba(255,180,90,0.16); color: #ffb45a; }
.tier-none { background: rgba(150,150,160,0.14); color: #9aa0aa; }
.tier-note { display: block; margin-top: 6px; font-size: 11px; color: var(--text-muted, #8a8f98); max-width: 340px; }
</style>
