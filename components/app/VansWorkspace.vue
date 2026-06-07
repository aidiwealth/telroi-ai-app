<template>
  <div>
    <div class="page-head van-head">
      <div>
        <h1 class="page-title">Virtual AI Numbers</h1>
        <p class="page-sub">Every business number, AI-powered. A VAN answers on the first ring, speaks your customers' language, and escalates to a human when it matters.</p>
      </div>
      <button class="btn btn-signal btn-sm" @click="openCreate()">+ New VAN</button>
    </div>

    <div v-if="pending" class="van-grid">
      <div v-for="i in 2" :key="i" class="card card-pad"><div class="skeleton skel-row" /></div>
    </div>

    <div v-else-if="vans.length" class="van-grid">
      <div v-for="v in vans" :key="v.id" class="van-card card">
        <div class="van-card-body">
          <div class="van-top">
            <div>
              <div class="van-name">{{ v.name }}</div>
              <div class="van-num mono">{{ v.telnum }}</div>
            </div>
            <span class="chip" :class="statusChip(v.status)">
              <span v-if="v.status === 'live'" class="pulse-dot" /> {{ v.status }}
            </span>
          </div>
          <div class="van-meta">
            <span class="van-meta-item">{{ agentName(v.agentId) }}</span>
            <span class="dot">·</span>
            <span class="van-meta-item">{{ (v.languages || ['en']).length }} lang</span>
          </div>
          <div class="van-escalate muted">
            Escalates to {{ v.escalateTo || 'a human' }}{{ v.escalateAfter ? ` after ${v.escalateAfter}s` : ' on intent' }}
          </div>
        </div>
        <div class="van-actions">
          <button v-if="v.status !== 'live'" class="btn btn-signal btn-sm" :disabled="busy === v.id" @click="setStatus(v, 'live')">
            {{ busy === v.id ? 'Activating…' : 'Go live' }}
          </button>
          <button v-else class="btn btn-ghost btn-sm" :disabled="busy === v.id" @click="setStatus(v, 'paused')">Pause</button>
          <button class="btn btn-ghost btn-sm" @click="openEdit(v)">Edit</button>
          <button class="btn btn-danger btn-sm" @click="remove(v)">Delete</button>
        </div>
      </div>
    </div>

    <div v-else class="card van-empty-card">
      <EmptyState icon="ai" title="No Virtual AI Numbers yet"
        description="Create your first VAN to turn a phone number into an AI assistant. You'll need at least one AI connection set up first.">
        <button class="btn btn-signal" @click="openCreate()">Create your first VAN</button>
      </EmptyState>
    </div>

    <!-- Create / edit drawer -->
    <Transition name="drawer">
      <div v-if="form" class="drawer-overlay" @click.self="form = null">
        <aside class="drawer van-drawer">
          <div class="drawer-head">
            <span class="drawer-sub">{{ editingId ? 'Edit VAN' : 'New Virtual AI Number' }}</span>
            <button class="modal-x" @click="form = null">✕</button>
          </div>

          <div class="field-float">
            <input v-model="form.name" class="input" placeholder=" " id="van-name" />
            <label for="van-name">Name</label>
          </div>
          <div class="field">
            <label>Phone number</label>
            <select v-model="form.telnum" class="select">
              <option :value="''">— Select an owned number —</option>
              <option v-for="n in ownedNumbers" :key="n.telnum" :value="n.telnum">{{ n.telnum }} · {{ n.region }}</option>
            </select>
            <span v-if="!ownedNumbers.length" class="hint">
              <template v-if="bundled">No numbers assigned yet — provision one under <NuxtLink to="/admin/inventory" class="inline-link">Number inventory</NuxtLink>, or set a support number in <NuxtLink to="/admin/settings" class="inline-link">Settings</NuxtLink>.</template>
              <template v-else>No numbers yet — <NuxtLink to="/numbers" class="inline-link">buy one on the Numbers page</NuxtLink>.</template>
            </span>
          </div>
          <div class="field">
            <label>AI agent</label>
            <select v-model="form.agentId" class="select">
              <option :value="undefined">— Select an agent —</option>
              <option v-for="a in agents" :key="a.id" :value="a.id">{{ a.name }}</option>
            </select>
            <span v-if="!agents.length" class="hint">No agents yet — <NuxtLink to="/ai" class="inline-link">create one on the AI page</NuxtLink>.</span>
          </div>
          <div class="field-float">
            <input v-model="form.escalateTo" class="input" placeholder=" " id="van-esc" />
            <label for="van-esc">Escalate to (human handoff)</label>
          </div>
          <div class="field">
            <label>Escalate after (seconds, 0 = on intent)</label>
            <input v-model.number="form.escalateAfter" class="input mono" type="number" min="0" />
          </div>
          <label class="van-toggle-row">
            <input type="checkbox" v-model="form.crmWriteback" /> Write transcripts &amp; intent to CRM
          </label>

          <button class="btn btn-signal btn-block" :disabled="saving || !form.name || !form.telnum" @click="save">
            {{ saving ? 'Saving…' : editingId ? 'Save changes' : 'Create VAN' }}
          </button>
          <p class="muted save-note">A VAN binds this number to the agent. Activating it points the number's inbound route at the AI runtime on your PBX.</p>
        </aside>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';

const props = withDefaults(defineProps<{ apiBase?: string; bundled?: boolean }>(), { apiBase: '/api/vans', bundled: false });
const api = useApi();
const toast = useToast();

interface Van { id: string; name: string; telnum: string; provider: string; agentId?: string; languages?: string[]; escalateTo?: string; escalateAfter?: number; crmWriteback: boolean; status: string; }
interface Agent { id: string; name: string; }

const pending = ref(true);
const vans = ref<Van[]>([]);
const agents = ref<Agent[]>([]);
const ownedNumbers = ref<any[]>([]);
const form = ref<any>(null);
const editingId = ref<string | null>(null);
const saving = ref(false);
const busy = ref<string | null>(null);

function statusChip(s: string) { return s === 'live' ? 'chip--ok' : s === 'paused' ? 'chip--missed' : ''; }
function agentName(id?: string) { return agents.value.find((a) => a.id === id)?.name || 'No agent'; }

async function load() {
  pending.value = true;
  try {
    if (props.bundled) {
      // Admin: a single endpoint returns vans + agents + numbers together.
      const r = await api.get<any>(props.apiBase);
      vans.value = r.vans || []; agents.value = r.agents || [];
      ownedNumbers.value = (r.numbers || []).filter((x: any) => x.status === 'active');
    } else {
      const [v, a, n] = await Promise.all([
        api.get<Van[]>(props.apiBase),
        api.get<Agent[]>('/api/agents'),
        api.get<any[]>('/api/numbers/subscriptions').catch(() => [])
      ]);
      vans.value = v; agents.value = a;
      ownedNumbers.value = (n || []).filter((x: any) => x.status === 'active');
    }
  } catch (e: any) { toast.err(e.message); }
  finally { pending.value = false; }
}

function openCreate() {
  editingId.value = null;
  form.value = { name: '', telnum: '', agentId: undefined, escalateTo: '', escalateAfter: 0, crmWriteback: true };
}
function openEdit(v: Van) {
  editingId.value = v.id;
  form.value = { ...v };
}

async function save() {
  saving.value = true;
  try {
    if (editingId.value) {
      await api.put(`${props.apiBase}/${editingId.value}`, form.value);
      toast.ok('VAN updated');
    } else {
      await api.post(props.apiBase, form.value);
      toast.ok('VAN created');
    }
    form.value = null;
    await load();
  } catch (e: any) { toast.err(e.message); }
  finally { saving.value = false; }
}

async function setStatus(v: Van, status: string) {
  busy.value = v.id;
  try {
    await api.post(`${props.apiBase}/${v.id}/activate`, { status });
    toast.ok(status === 'live' ? `${v.name} is live` : `${v.name} paused`);
    await load();
  } catch (e: any) { toast.err(e.message); }
  finally { busy.value = null; }
}

async function remove(v: Van) {
  try { await api.del(`${props.apiBase}/${v.id}`); toast.ok('Deleted'); await load(); }
  catch (e: any) { toast.err(e.message); }
}

onMounted(load);
</script>

<style scoped>
.van-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; }
.van-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; }
.van-card { display: flex; flex-direction: column; overflow: hidden; }
.van-card-body { padding: 22px 24px; flex: 1; }
.van-top { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 14px; }
.van-name { font-family: var(--font-display); font-size: 20px; letter-spacing: -0.01em; }
.van-num { font-size: 13px; color: var(--ink-soft); margin-top: 2px; }
.van-meta { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--ink-soft); margin-bottom: 10px; }
.van-meta-item { text-transform: capitalize; }
.van-escalate { font-size: 12.5px; }
.van-actions { display: flex; gap: 8px; padding: 14px 24px; border-top: 1px solid var(--rule-2); background: var(--paper-2); }
.pulse-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--live); display: inline-block; animation: livepulse 1.5s ease-in-out infinite; }
.van-empty-card { padding: 20px; }

.van-toggle-row { display: flex; align-items: center; gap: 10px; font-size: 14px; margin: 4px 0 22px; cursor: pointer; }
.inline-link { color: var(--signal); }
.save-note { font-size: 12px; margin-top: 12px; line-height: 1.5; }

.drawer-overlay { position: fixed; inset: 0; z-index: 150; background: rgba(10,10,11,0.28); display: flex; justify-content: flex-end; }
.drawer { width: 440px; max-width: 92vw; background: var(--paper); height: 100%; padding: 28px; overflow-y: auto; box-shadow: var(--shadow-pop); }
.drawer-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; }
.drawer-sub { font-family: var(--font-mono); font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--ink-soft); }
.modal-x { color: var(--ink-mute); }
.skel-row { height: 80px; }

.drawer-enter-active, .drawer-leave-active { transition: opacity .2s; }
.drawer-enter-from, .drawer-leave-to { opacity: 0; }
@media (max-width: 820px) { .van-grid { grid-template-columns: 1fr; } }
</style>
