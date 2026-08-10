<template>
  <div>
    <div class="page-head">
      <h1 class="page-title">Developers</h1>
      <p class="page-sub">Build on Telroi. Your API key authenticates against the same infrastructure the dashboard uses — calls, numbers, agents and Virtual AI Numbers, one REST API.</p>
    </div>

    <nav class="dev-tabs">
      <button class="dev-tab" :class="{ on: tab === 'api' }" @click="tab = 'api'">API keys</button>
      <button class="dev-tab" :class="{ on: tab === 'hooks' }" @click="tab = 'hooks'">Webhooks</button>
    </nav>

    <!-- API keys -->
    <div v-show="tab === 'api'" class="card dev-card">
      <div class="card-head">
        <span class="card-title">API keys</span>
        <button class="btn btn-signal btn-sm" @click="showCreate = true">+ New key</button>
      </div>

      <div v-if="pending" class="loading-pad"><div v-for="i in 2" :key="i" class="skeleton skel-row" /></div>
      <table v-else-if="keys.length" class="table">
        <thead><tr><th>Name</th><th>Key</th><th>Last used</th><th>Created</th><th></th></tr></thead>
        <tbody>
          <tr v-for="k in keys" :key="k.id" :class="{ 'dev-revoked': k.revoked }">
            <td>{{ k.name }}</td>
            <td class="mono">{{ k.masked }}</td>
            <td class="muted">{{ k.lastUsedAt ? fmt(k.lastUsedAt) : 'Never' }}</td>
            <td class="muted">{{ fmt(k.createdAt) }}</td>
            <td class="row-actions">
              <span v-if="k.revoked" class="chip chip--missed">Revoked</span>
              <button v-else class="btn btn-danger btn-sm" @click="revoke(k.id)">Revoke</button>
            </td>
          </tr>
        </tbody>
      </table>
      <EmptyState v-else icon="keys" title="No API keys" description="Create a key to start building on the Telroi API." />
    </div>

    <!-- Webhooks. Only the events they ask for, because at volume the
         difference between a useful integration and a flood is what you
         subscribe to. -->
    <div v-show="tab === 'hooks'" class="card dev-card">
      <div class="card-head">
        <span class="card-title">Webhooks</span>
        <button v-if="!hooks.endpoints?.length" class="btn btn-signal btn-sm" @click="showHook = true">+ Add endpoint</button>
      </div>

      <div class="card-pad">
        <p class="dev-note">We'll POST to your URL when something happens on your account. Each request carries a <code>telroi-signature</code> header — an HMAC-SHA256 of the body using your signing secret — so you can tell a real delivery from anything else pointed at your endpoint.</p>

        <div v-for="e in hooks.endpoints || []" :key="e.id" class="dev-hook">
          <div class="dev-hook-head">
            <span class="mono">{{ e.url }}</span>
            <button class="btn btn-danger btn-sm" @click="removeHook(e)">Remove</button>
          </div>
          <div class="dev-hook-events">
            <span v-for="ev in e.events" :key="ev" class="chip">{{ ev }}</span>
          </div>
          <div v-if="!e.enabled" class="dev-hook-off">
            <strong>Switched off.</strong> {{ e.disabledReason || 'Too many consecutive failures.' }}
            <button class="btn btn-ghost btn-sm" @click="enableHook(e)">Turn it back on</button>
          </div>
        </div>

        <div v-if="hooks.deliveries?.length" class="dev-deliveries">
          <h4 class="dev-sub">Recent deliveries</h4>
          <table class="table">
            <thead><tr><th>Event</th><th>When</th><th>Result</th></tr></thead>
            <tbody>
              <tr v-for="d in hooks.deliveries" :key="d.id">
                <td class="mono">{{ d.eventType }}</td>
                <td class="muted">{{ fmt(d.createdAt) }}</td>
                <td>
                  <span class="chip" :class="d.status === 'delivered' ? 'chip--ok' : d.status === 'failed' ? 'chip--missed' : ''">{{ d.status }}</span>
                  <span v-if="d.responseStatus" class="muted"> · {{ d.responseStatus }}</span>
                  <span v-if="d.attempts > 1" class="muted"> · {{ d.attempts }} attempts</span>
                  <span v-if="d.responseExcerpt && d.status !== 'delivered'" class="dev-resp">{{ d.responseExcerpt }}</span>
                </td>
              </tr>
            </tbody>
          </table>
          <p class="dev-note">Deliveries are kept for thirty days. We try four times over about an hour, then stop.</p>
        </div>
      </div>
    </div>

    <!-- Documentation sits with the keys: both are what you reach for when
         starting, and webhooks are what you reach for once running. -->
    <div v-show="tab === 'api'">
    <!-- Full API documentation lives at /api/docs (public, standalone). The
         dashboard page is just keys + settings; no inline docs duplicated here. -->
    <div class="card dev-card">
      <div class="dev-docs-cta">
        <div>
          <span class="card-title">API documentation</span>
          <p class="dev-docs-sub">Full reference for every endpoint — Voice OTP, Speech, Calls, Numbers, AI Agents, CRM and webhooks — with examples and the OpenAPI spec.</p>
        </div>
        <a href="https://developers.telroi.ai" target="_blank" rel="noopener" class="btn btn-signal btn-sm">View API docs →</a>
      </div>
    </div>
    </div>


    <!-- Add endpoint modal -->
    <div v-if="showHook" class="modal-overlay" @click.self="showHook = false">
      <div class="modal card">
        <div class="card-head"><span class="card-title">Add a webhook endpoint</span><button class="modal-x" @click="showHook = false">✕</button></div>
        <div class="card-pad">
          <div class="field">
            <label>Your URL</label>
            <input v-model="hookForm.url" class="input mono" placeholder="https://example.com/telroi/webhooks" />
          </div>
          <div class="field">
            <label>Events</label>
            <label v-for="t in hooks.eventTypes || []" :key="t.id" class="dev-ev">
              <input type="checkbox" :value="t.id" v-model="hookForm.events" />
              <span><strong>{{ t.label }}</strong> <span class="muted">— {{ t.note }}</span></span>
            </label>
          </div>
          <button class="btn btn-signal btn-block" :disabled="hookSaving || !hookForm.url || !hookForm.events.length" @click="saveHook">
            {{ hookSaving ? 'Saving…' : 'Add endpoint' }}
          </button>
        </div>
      </div>
    </div>

    <!-- The signing secret, shown once. -->
    <div v-if="hookSecret" class="modal-overlay" @click.self="hookSecret = null">
      <div class="modal card">
        <div class="card-head"><span class="card-title">Save your signing secret</span><button class="modal-x" @click="hookSecret = null">✕</button></div>
        <div class="card-pad">
          <p class="dev-note">Shown <strong>once</strong>. Use it to verify the <code>telroi-signature</code> header on every delivery — without it you cannot tell our requests from anyone else's.</p>
          <div class="sip-secret-box"><code>{{ hookSecret }}</code><button class="sip-copy" @click="copy(hookSecret)">Copy</button></div>
          <button class="btn btn-signal btn-block" @click="hookSecret = null">I've saved it</button>
        </div>
      </div>
    </div>

    <!-- Create key modal -->
    <div v-if="showCreate" class="modal-overlay" @click.self="closeCreate">
      <div class="modal card">
        <div class="card-head"><span class="card-title">{{ newKey ? 'Key created' : 'New API key' }}</span><button class="modal-x" @click="closeCreate">✕</button></div>
        <div class="card-pad">
          <template v-if="!newKey">
            <div class="field"><label>Key name</label><input v-model="draft.name" class="input" placeholder="Production server" /></div>
            <div class="field"><label>Mode</label>
              <select v-model="draft.mode" class="select"><option value="live">Live</option><option value="test">Test</option></select>
            </div>
            <button class="btn btn-signal btn-block" :disabled="creating || !draft.name" @click="create">{{ creating ? 'Creating…' : 'Create key' }}</button>
          </template>
          <template v-else>
            <p class="dev-warn">Copy this key now — you won't be able to see it again.</p>
            <div class="dev-newkey mono">{{ newKey }}</div>
            <button class="btn btn-dark btn-block" @click="copyKey">{{ copied ? 'Copied ✓' : 'Copy key' }}</button>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue';

useHead({ title: 'Developers — Telroi' });
const api = useApi();
const toast = useToast();
const baseUrl = useRuntimeConfig().public.appBaseUrl;

const pending = ref(true);
const keys = ref<any[]>([]);

const tab = ref('api');
const hooks = ref<any>({ endpoints: [], deliveries: [], eventTypes: [] });
const showHook = ref(false);
const hookSaving = ref(false);
const hookSecret = ref<string | null>(null);
const hookForm = reactive({ url: '', events: [] as string[] });

async function loadHooks() {
  try { hooks.value = await api.get('/api/webhook-endpoints'); }
  catch { /* the keys above are still worth showing */ }
}

async function saveHook() {
  hookSaving.value = true;
  try {
    const r = await api.post<any>('/api/webhook-endpoints', { url: hookForm.url.trim(), events: hookForm.events });
    showHook.value = false;
    // Shown once and never again — we keep only enough to sign with.
    hookSecret.value = r.secret;
    hookForm.url = ''; hookForm.events = [];
    await loadHooks();
  } catch (e: any) { toast.err(e.message); }
  finally { hookSaving.value = false; }
}

async function removeHook(e: any) {
  try {
    await api.del(`/api/webhook-endpoints/${e.id}`);
    toast.ok('Endpoint removed');
    await loadHooks();
  } catch (err: any) { toast.err(err.message); }
}

async function enableHook(e: any) {
  try {
    await api.post(`/api/webhook-endpoints/${e.id}/enable`, {});
    toast.ok('Back on — we will start sending again');
    await loadHooks();
  } catch (err: any) { toast.err(err.message); }
}
const showCreate = ref(false);
const creating = ref(false);
const newKey = ref('');
const copied = ref(false);
const draft = reactive({ name: '', mode: 'live' });
onMounted(() => {
  loadHooks();
  if (import.meta.client) {
    const env = localStorage.getItem('telroi_env');
    draft.mode = env === 'sandbox' ? 'test' : 'live';
  }
});

function fmt(iso: string) { return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); }

async function load() {
  pending.value = true;
  try { keys.value = await api.get<any[]>('/api/keys'); }
  catch (e: any) { toast.err(e.message); }
  finally { pending.value = false; }
}

async function create() {
  creating.value = true;
  try {
    const r = await api.post<{ key: string }>('/api/keys', { name: draft.name, mode: draft.mode });
    newKey.value = r.key;
    await load();
  } catch (e: any) { toast.err(e.message); }
  finally { creating.value = false; }
}

function copyKey() {
  navigator.clipboard.writeText(newKey.value);
  copied.value = true;
  setTimeout(() => (copied.value = false), 2000);
}

function closeCreate() {
  showCreate.value = false;
  newKey.value = '';
  draft.name = '';
  copied.value = false;
}

async function revoke(id: string) {
  try { await api.del(`/api/keys/${id}`); toast.ok('Key revoked'); await load(); }
  catch (e: any) { toast.err(e.message); }
}

onMounted(load);
</script>

<style scoped>
.dev-note { font-size: 13px; color: var(--ink-soft); line-height: 1.6; margin: 0 0 14px; max-width: 72ch; }
.dev-hook { border: 1px solid var(--rule); border-radius: var(--radius); padding: 14px 16px; margin-bottom: 12px; }
.dev-hook-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; margin-bottom: 8px; }
.dev-hook-head .mono { word-break: break-all; min-width: 0; flex: 1; font-size: 13px; line-height: 1.5; }
.dev-hook-head .btn { flex: none; }
.dev-hook-events { display: flex; gap: 6px; flex-wrap: wrap; }
.dev-hook-off { margin-top: 12px; padding: 10px 12px; border-radius: var(--radius); background: rgba(180,45,45,.08); font-size: 13px; display: flex; align-items: center; gap: 10px; justify-content: space-between; }
.dev-deliveries { margin-top: 22px; }
.dev-sub { font-size: 13px; text-transform: uppercase; letter-spacing: .04em; color: var(--ink-soft); margin: 0 0 10px; }
.dev-resp { display: block; font-size: 12px; color: var(--ink-soft); margin-top: 2px; }
.dev-ev { display: flex; gap: 8px; align-items: flex-start; padding: 6px 0; font-size: 13.5px; }
.dev-tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--rule); margin: 22px 0 20px; }
.dev-tab { padding: 10px 16px; font-size: 14px; color: var(--ink-soft); border: 0; background: none; border-bottom: 2px solid transparent; margin-bottom: -1px; cursor: pointer; }
.dev-tab.on { color: var(--signal); border-bottom-color: var(--signal); font-weight: 500; }
.sip-secret-box code { word-break: break-all; }
.dev-card { margin-bottom: 24px; overflow: hidden; }
.loading-pad { padding: 16px 24px; display: flex; flex-direction: column; gap: 10px; }
.skel-row { height: 20px; }
.row-actions { text-align: right; }
.dev-revoked { opacity: 0.5; }

.dev-docs-cta { display: flex; align-items: center; justify-content: space-between; gap: 20px; padding: 22px 24px; flex-wrap: wrap; }
.dev-docs-sub { font-size: 13px; color: var(--ink-soft); margin-top: 4px; max-width: 520px; line-height: 1.5; }

.modal-overlay { position: fixed; inset: 0; z-index: 200; background: rgba(10,10,11,0.32); display: flex; align-items: center; justify-content: center; padding: 24px; }
.modal { width: 100%; max-width: 440px; background: var(--paper); }
.modal-x { color: var(--ink-mute); }
.dev-warn { font-size: 13px; color: var(--warn); margin-bottom: 14px; }
.dev-newkey { background: var(--paper-3); border: 1px solid var(--rule); border-radius: var(--radius); padding: 14px; font-size: 13px; word-break: break-all; margin-bottom: 16px; }

@media (max-width: 820px) { .dev-ep { grid-template-columns: 50px 1fr; } .dev-desc { display: none; } }
</style>
