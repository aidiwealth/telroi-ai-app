<template>
  <div>
    <div class="ad-page-head">
      <div>
        <h1 class="ad-title">Support teams</h1>
        <p class="ad-sub">Groups on our own desk. The AI reads these when a caller asks for a particular team — the description is what it routes on, so write it as the caller would describe their problem.</p>
      </div>
      <button class="btn btn-signal btn-sm" @click="openCreate">+ New team</button>
    </div>

    <div v-if="loading" class="card card-pad muted">Loading…</div>

    <div v-else-if="!departments.length" class="card card-pad muted">
      No teams yet. Without one, a caller asking for a department reaches whatever the VAN escalation is set to.
    </div>

    <div v-else class="tm-list">
      <div v-for="d in departments" :key="d.id" class="card tm-card">
        <div class="tm-head">
          <div>
            <h3 class="tm-name">{{ d.name }}</h3>
            <p class="tm-desc" :class="{ muted: !d.description }">
              {{ d.description || 'No description — the AI has only the name to route on.' }}
            </p>
          </div>
          <div class="tm-actions">
            <button class="tm-link" @click="openEdit(d)">Edit</button>
            <button class="tm-link danger" @click="remove(d)">Delete</button>
          </div>
        </div>

        <div class="tm-members">
          <div class="tm-col-h">Members <span class="tm-count">{{ (d.members || []).length }}</span></div>
          <div v-if="!(d.members || []).length" class="muted tm-empty">Nobody here yet — calls to this team would ring no one.</div>
          <div v-for="m in d.members || []" :key="m.id || m.userId" class="tm-member">
            <span>{{ m.user?.name || m.user?.email || m.email || '—' }}</span>
            <button class="tm-link danger" @click="removeMember(d, m)">Remove</button>
          </div>
          <div class="tm-add">
            <select v-model="addUser[d.id]" class="ad-input">
              <option value="">Add someone…</option>
              <option v-for="p in available(d)" :key="p.userId" :value="p.userId">{{ p.name || p.email }}</option>
            </select>
            <button class="btn btn-ghost btn-sm" :disabled="!addUser[d.id]" @click="addMember(d)">Add</button>
          </div>
        </div>
      </div>
    </div>

    <div v-if="showForm" class="cmp-policy-overlay" @click.self="showForm = false">
      <div class="cmp-policy-modal">
        <div class="cmp-policy-head">
          <div><h3>{{ editing ? 'Edit team' : 'New team' }}</h3></div>
          <button class="cmp-policy-x" @click="showForm = false">✕</button>
        </div>
        <div class="cmp-policy-body">
          <label class="ad-field"><span>Name</span>
            <input v-model="form.name" class="ad-input" placeholder="Billing" />
          </label>
          <label class="ad-field"><span>What they handle</span>
            <input v-model="form.description" class="ad-input" placeholder="invoices, payments and refunds" />
            <span class="ad-hint">The AI matches a caller's problem against this, so plain words beat job titles.</span>
          </label>
        </div>
        <div class="policy-modal-foot">
          <button class="btn btn-ghost btn-sm" @click="showForm = false">Cancel</button>
          <button class="btn btn-signal btn-sm" :disabled="!form.name || saving" @click="save">{{ saving ? 'Saving…' : 'Save' }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue';
definePageMeta({ layout: 'admin' });
useHead({ title: 'Support teams — Telroi' });

const loading = ref(true);
const saving = ref(false);
const departments = ref<any[]>([]);
const members = ref<any[]>([]);
const addUser = reactive<Record<string, string>>({});
const showForm = ref(false);
const editing = ref<any>(null);
const form = reactive({ name: '', description: '' });

function available(d: any) {
  const inTeam = new Set((d.members || []).map((m: any) => m.userId || m.user?.id));
  return members.value.filter((p) => !inTeam.has(p.userId));
}

async function load() {
  loading.value = true;
  try {
    const [dr, mr] = await Promise.all([
      $fetch<any>('/api/admin/support/departments'),
      $fetch<any>('/api/admin/support/members').catch(() => ({ members: [] }))
    ]);
    departments.value = dr.departments || [];
    members.value = mr.members || [];
  } catch (e: any) { alert(e?.data?.error?.message || 'Could not load teams'); }
  finally { loading.value = false; }
}

function openCreate() { editing.value = null; form.name = ''; form.description = ''; showForm.value = true; }
function openEdit(d: any) { editing.value = d; form.name = d.name; form.description = d.description || ''; showForm.value = true; }

async function save() {
  saving.value = true;
  try {
    if (editing.value) await $fetch(`/api/admin/support/departments/${editing.value.id}`, { method: 'PUT', body: { name: form.name, description: form.description } });
    else await $fetch('/api/admin/support/departments', { method: 'POST', body: { name: form.name, description: form.description } });
    showForm.value = false;
    await load();
  } catch (e: any) { alert(e?.data?.error?.message || 'Save failed'); }
  finally { saving.value = false; }
}

async function remove(d: any) {
  if (!confirm(`Delete ${d.name}? Calls routed here will fall back to the VAN escalation.`)) return;
  try { await $fetch(`/api/admin/support/departments/${d.id}`, { method: 'DELETE' }); await load(); }
  catch (e: any) { alert(e?.data?.error?.message || 'Delete failed'); }
}

async function addMember(d: any) {
  const userId = addUser[d.id];
  if (!userId) return;
  try { await $fetch(`/api/admin/support/departments/${d.id}/members`, { method: 'POST', body: { userId } }); addUser[d.id] = ''; await load(); }
  catch (e: any) { alert(e?.data?.error?.message || 'Could not add'); }
}

async function removeMember(d: any, m: any) {
  try { await $fetch(`/api/admin/support/departments/${d.id}/members`, { method: 'DELETE', body: { userId: m.userId || m.user?.id } }); await load(); }
  catch (e: any) { alert(e?.data?.error?.message || 'Could not remove'); }
}

onMounted(load);
</script>

<style scoped>
.tm-list { display: flex; flex-direction: column; gap: 14px; }
.tm-card { padding: 20px 22px; }
.tm-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; margin-bottom: 16px; }
.tm-name { font-size: 17px; margin: 0 0 4px; color: var(--ink); }
.tm-desc { font-size: 13px; color: var(--ink-soft); margin: 0; }
.tm-actions { display: flex; gap: 12px; flex: none; }
.tm-link { background: none; border: 0; color: var(--signal); font-size: 13px; cursor: pointer; padding: 0; }
.tm-link.danger { color: #a33; }
.tm-members { border-top: 1px solid var(--rule); padding-top: 14px; }
.tm-col-h { font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: var(--ink-soft); margin-bottom: 10px; }
.tm-count { background: var(--paper-2); border-radius: 999px; padding: 1px 7px; margin-left: 6px; }
.tm-member { display: flex; justify-content: space-between; align-items: center; padding: 7px 0; font-size: 14px; }
.tm-empty { font-size: 13px; padding: 4px 0 10px; }
.tm-add { display: flex; gap: 8px; margin-top: 12px; }
.tm-add .ad-input { flex: 1; }
</style>
