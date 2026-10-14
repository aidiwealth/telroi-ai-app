<template>
  <div>
    <div class="page-head sa-head">
      <div>
        <h1 class="page-title">Sub-accounts</h1>
        <p class="page-sub">Create and manage customer accounts under your workspace. Every sub-account’s usage is billed to your one wallet; each gets its own API key, and sees only its own data.</p>
      </div>
      <button class="btn btn-signal" @click="showCreate = true">+ New sub-account</button>
    </div>

    <div class="card">
      <div v-if="pending" class="loading-pad"><div v-for="i in 3" :key="i" class="skeleton skel-row" /></div>
      <table v-else-if="subs.length" class="table">
        <thead><tr><th>Name</th><th>Reference</th><th>Status</th><th>Keys</th><th>OTPs</th><th>Created</th><th></th></tr></thead>
        <tbody>
          <tr v-for="sa in subs" :key="sa.id">
            <td><strong>{{ sa.name }}</strong></td>
            <td class="muted mono">{{ sa.reference || '—' }}</td>
            <td><span class="chip" :class="sa.status === 'active' ? 'chip--answered' : 'chip--missed'">{{ sa.status }}</span></td>
            <td>{{ sa.keyCount }}</td>
            <td class="muted">{{ sa.otpCount }}</td>
            <td class="muted">{{ fmt(sa.createdAt) }}</td>
            <td class="row-actions">
              <button class="btn btn-ghost btn-sm" @click="openKeys(sa)">Keys</button>
              <button v-if="sa.status === 'active'" class="btn btn-ghost btn-sm" @click="setStatus(sa, 'suspended')">Suspend</button>
              <button v-else class="btn btn-ghost btn-sm" @click="setStatus(sa, 'active')">Reactivate</button>
            </td>
          </tr>
        </tbody>
      </table>
      <EmptyState v-else icon="team" title="No sub-accounts yet" description="Create one to onboard a customer under your account." />
    </div>

    <!-- Create -->
    <div v-if="showCreate" class="modal-overlay" @click.self="showCreate = false">
      <div class="modal card">
        <div class="card-head"><span class="card-title">New sub-account</span><button class="modal-x" @click="showCreate = false">&times;</button></div>
        <div class="card-pad">
          <div class="field"><label>Name</label><input v-model="form.name" class="input" placeholder="Acme Bank" /></div>
          <div class="field"><label>Reference (optional)</label><input v-model="form.reference" class="input mono" placeholder="your own id" /></div>
          <button class="btn btn-signal btn-block" :disabled="busy || !form.name" @click="create">{{ busy ? 'Creating…' : 'Create sub-account' }}</button>
        </div>
      </div>
    </div>

    <!-- Keys drawer -->
    <div v-if="keysFor" class="modal-overlay" @click.self="keysFor = null">
      <div class="modal card">
        <div class="card-head"><span class="card-title">{{ keysFor.name }} — API keys</span><button class="modal-x" @click="keysFor = null">&times;</button></div>
        <div class="card-pad">
          <div v-if="newKey" class="keybox">
            <p class="muted" style="font-size:12px">Copy this key now — it is shown only once.</p>
            <code class="mono keyval">{{ newKey }}</code>
          </div>
          <button class="btn btn-signal btn-sm" :disabled="busy" @click="issueKey">+ Issue key</button>
          <table v-if="keys.length" class="table" style="margin-top:12px">
            <thead><tr><th>Name</th><th>Key</th><th>Created</th><th></th></tr></thead>
            <tbody>
              <tr v-for="k in keys" :key="k.id" :class="{ 'dev-revoked': k.revoked }">
                <td>{{ k.name }}</td><td class="mono">{{ k.masked }}</td><td class="muted">{{ fmt(k.createdAt) }}</td>
                <td><span v-if="k.revoked" class="chip chip--missed">Revoked</span>
                    <button v-else class="btn btn-danger btn-sm" @click="revokeKey(k.id)">Revoke</button></td>
              </tr>
            </tbody>
          </table>
          <p v-else class="muted" style="margin-top:10px">No keys yet.</p>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useAuthStore } from '~/stores/auth';
const api = useApi();
const _auth = useAuthStore();
if (import.meta.client && _auth.tenant && !_auth.tenant.subAccountsEnabled) navigateTo('/');
const subs = ref<any[]>([]);
const pending = ref(true);
const showCreate = ref(false);
const busy = ref(false);
const form = ref({ name: '', reference: '' });
const keysFor = ref<any>(null);
const keys = ref<any[]>([]);
const newKey = ref('');

function fmt(d: string) { return d ? new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—'; }

async function load() {
  pending.value = true;
  try { const r = await api.get<any>('/api/tenant/sub-accounts'); subs.value = r.subAccounts || []; }
  catch { subs.value = []; } finally { pending.value = false; }
}
async function create() {
  busy.value = true;
  try { await api.post('/api/tenant/sub-accounts', { name: form.value.name, reference: form.value.reference || undefined });
    showCreate.value = false; form.value = { name: '', reference: '' }; await load(); }
  catch (e: any) { alert(e?.data?.error?.message || 'Could not create'); } finally { busy.value = false; }
}
async function setStatus(sa: any, status: string) {
  try { await api.patch(`/api/tenant/sub-accounts/${sa.id}`, { status }); await load(); }
  catch (e: any) { alert(e?.data?.error?.message || 'Could not update'); }
}
async function openKeys(sa: any) {
  keysFor.value = sa; newKey.value = ''; keys.value = [];
  try { const r = await api.get<any>(`/api/tenant/sub-accounts/${sa.id}/keys`); keys.value = r.keys || []; } catch { /* */ }
}
async function issueKey() {
  busy.value = true;
  try { const r = await api.post<any>(`/api/tenant/sub-accounts/${keysFor.value.id}/keys`, { });
    newKey.value = r.key; await openKeysRefresh(); await load(); }
  catch (e: any) { alert(e?.data?.error?.message || 'Could not issue key'); } finally { busy.value = false; }
}
async function openKeysRefresh() {
  try { const r = await api.get<any>(`/api/tenant/sub-accounts/${keysFor.value.id}/keys`); keys.value = r.keys || []; } catch { /* */ }
}
async function revokeKey(keyId: string) {
  try { await api.del(`/api/tenant/sub-accounts/${keysFor.value.id}/keys/${keyId}`); await openKeysRefresh(); await load(); }
  catch (e: any) { alert(e?.data?.error?.message || 'Could not revoke'); }
}
onMounted(load);
</script>

<style scoped>
.sa-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; flex-wrap: wrap; }
.sa-head .btn { flex: none; margin-top: 2px; }

.keybox { background: var(--paper-2); border: 1px solid var(--line); border-radius: var(--radius-sm); padding: 10px 12px; margin-bottom: 10px; }
.keyval { display: block; word-break: break-all; font-size: 12px; margin-top: 4px; }
</style>
