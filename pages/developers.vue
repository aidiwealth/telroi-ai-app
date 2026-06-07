<template>
  <div>
    <div class="page-head">
      <h1 class="page-title">Developers</h1>
      <p class="page-sub">Build on Telroi. Your API key authenticates against the same infrastructure the dashboard uses — calls, numbers, agents and Virtual AI Numbers, one REST API.</p>
    </div>

    <!-- API keys -->
    <div class="card dev-card">
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

    <!-- Full API documentation lives at /api/docs (public, standalone). The
         dashboard page is just keys + settings; no inline docs duplicated here. -->
    <div class="card dev-card">
      <div class="dev-docs-cta">
        <div>
          <span class="card-title">API documentation</span>
          <p class="dev-docs-sub">Full reference for every endpoint — Voice OTP, Speech, Calls, Numbers, AI Agents, CRM and webhooks — with examples and the OpenAPI spec.</p>
        </div>
        <a :href="`${baseUrl}/api/docs`" target="_blank" rel="noopener" class="btn btn-signal btn-sm">View API docs →</a>
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
const showCreate = ref(false);
const creating = ref(false);
const newKey = ref('');
const copied = ref(false);
const draft = reactive({ name: '', mode: 'live' });
onMounted(() => {
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
