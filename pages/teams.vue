<template>
  <div>
    <div class="page-head tm-pagehead">
      <div>
        <h1 class="page-title">Teams &amp; departments</h1>
        <p class="page-sub">Group people into teams, assign numbers to them, and control who can make or take calls.</p>
      </div>
      <button v-if="canManage" class="btn btn-signal btn-sm" @click="openCreate">+ New team</button>
    </div>

    <div v-if="!canManage" class="card card-pad muted">Only workspace owners and admins can manage teams.</div>

    <div v-else-if="pending" class="tm-grid">
      <div v-for="i in 2" :key="i" class="card card-pad"><div class="skeleton skel-row" /></div>
    </div>

    <div v-else-if="departments.length" class="tm-list">
      <div v-for="d in departments" :key="d.id" class="card tm-card">
        <div class="tm-head">
          <div>
            <h3 class="tm-name">{{ d.name }}</h3>
            <p v-if="d.description" class="tm-desc">{{ d.description }}</p>
          </div>
          <div class="tm-head-actions">
            <button class="tm-link" @click="openEdit(d)">Edit</button>
            <button class="tm-link danger" @click="remove(d)">Delete</button>
          </div>
        </div>

        <div class="tm-cols">
          <!-- Members -->
          <div class="tm-col">
            <div class="tm-col-h">Members <span class="tm-count">{{ d.members.length }}</span></div>
            <div v-for="m in d.members" :key="m.id" class="tm-member">
              <div class="tm-member-id">
                <span class="tm-avatar">{{ initials(m.user) }}</span>
                <div>
                  <div class="tm-member-name">{{ m.user?.name || m.user?.email || '—' }}</div>
                  <div class="tm-caps">
                    <label><input type="checkbox" :checked="m.canMakeCalls" @change="setCap(d, m, 'canMakeCalls', $event)" /> Make</label>
                    <label><input type="checkbox" :checked="m.canTakeCalls" @change="setCap(d, m, 'canTakeCalls', $event)" /> Take</label>
                    <label><input type="checkbox" :checked="m.canOperate" @change="setCap(d, m, 'canOperate', $event)" /> Operate</label>
                  </div>
                </div>
              </div>
              <button class="tm-x" @click="removeMember(d, m)" title="Remove">✕</button>
            </div>
            <p v-if="!d.members.length" class="tm-none">No members yet.</p>
            <div class="tm-add">
              <select v-model="addUser[d.id]" class="select">
                <option value="">Add member…</option>
                <option v-for="u in availableUsers(d)" :key="u.userId" :value="u.userId">{{ u.name || u.email }}</option>
              </select>
              <button class="btn btn-ghost btn-sm" :disabled="!addUser[d.id]" @click="addMember(d)">Add</button>
            </div>
          </div>

          <!-- Numbers -->
          <div class="tm-col">
            <div class="tm-col-h">Numbers <span class="tm-count">{{ d.numbers.length }}</span></div>
            <div v-for="n in d.numbers" :key="n.id" class="tm-number">
              <span class="mono">{{ n.telnum }}</span>
              <button class="tm-x" @click="assignNumber(n.id, null)" title="Unassign">✕</button>
            </div>
            <p v-if="!d.numbers.length" class="tm-none">No numbers assigned.</p>
            <div class="tm-add">
              <select v-model="addNumber[d.id]" class="select">
                <option value="">Assign a number…</option>
                <option v-for="n in unassignedNumbers" :key="n.id" :value="n.id">{{ n.telnum }} · {{ n.region }}</option>
              </select>
              <button class="btn btn-ghost btn-sm" :disabled="!addNumber[d.id]" @click="assignNumber(addNumber[d.id], d.id)">Assign</button>
            </div>
          </div>
        </div>

        <div class="tm-routing">
          <div class="tm-col-h">Call routing</div>
          <div class="tm-routing-row">
            <label>Incoming calls ring</label>
            <select :value="d.ringStrategy" class="select" @change="setRouting(d, 'ringStrategy', $event)">
              <option value="simultaneous">everyone at once</option>
              <option value="round_robin">one at a time (rotating)</option>
              <option value="linear">one at a time (in order)</option>
            </select>
            <label>for</label>
            <input type="number" min="5" max="120" :value="d.ringTimeout" class="input tm-timeout" @change="setRouting(d, 'ringTimeout', $event)" />
            <span class="muted">sec</span>
          </div>
        </div>
      </div>
    </div>

    <div v-else class="card"><EmptyState icon="groups" title="No teams yet" description="Create your first team to group people and assign numbers." /></div>

    <!-- Create / Edit -->
    <div v-if="showModal" class="modal-overlay" @click.self="showModal = false">
      <div class="modal card">
        <div class="card-head">
          <span class="card-title">{{ editing ? 'Edit team' : 'New team' }}</span>
          <button class="modal-x" @click="showModal = false">✕</button>
        </div>
        <div class="card-pad">
          <div class="field"><label>Name</label><input v-model="form.name" class="input" placeholder="e.g. Sales, Support" /></div>
          <div class="field"><label>Description (optional)</label><input v-model="form.description" class="input" placeholder="What this team handles" /></div>
          <button class="btn btn-signal btn-block" :disabled="saving || !form.name" @click="save">{{ saving ? 'Saving…' : (editing ? 'Save' : 'Create team') }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue';
import { useAuthStore } from '~/stores/auth';

const api = useApi();
const toast = useToast();
const auth = useAuthStore();

const canManage = computed(() => {
  const r = (auth.user as any)?.role;
  // owner/admin manage teams; members can view but actions are server-guarded too.
  return r === 'owner' || r === 'admin';
});

const departments = ref<any[]>([]);
const members = ref<any[]>([]);   // workspace members (for the add-member dropdown)
const pending = ref(true);
const addUser = reactive<Record<string, string>>({});
const addNumber = reactive<Record<string, string>>({});

const showModal = ref(false);
const editing = ref<any>(null);
const saving = ref(false);
const form = reactive({ name: '', description: '' });

const allNumbers = computed(() => departments.value.flatMap((d) => d.numbers));
const unassignedNumbers = ref<any[]>([]);

function initials(u: any) { return ((u?.name || u?.email || '?').trim()[0] || '?').toUpperCase(); }
function availableUsers(d: any) {
  const inDept = new Set(d.members.map((m: any) => m.userId));
  return members.value.filter((u) => !inDept.has(u.userId));
}

async function load() {
  pending.value = true;
  try {
    const [dRes, mRes, nRes] = await Promise.all([
      api.get<{ departments: any[] }>('/api/departments'),
      api.get<any[]>('/api/tenant/members').catch(() => []),
      api.get<any[]>('/api/numbers/subscriptions').catch(() => [])
    ]);
    departments.value = dRes.departments;
    // Normalize members list to { userId, name, email }
    members.value = (Array.isArray(mRes) ? mRes : (mRes as any).members || []).map((m: any) => ({
      userId: m.userId || m.id, name: m.name, email: m.email
    }));
    // Numbers not assigned to any department
    const assigned = new Set(departments.value.flatMap((d) => d.numbers.map((n: any) => n.id)));
    unassignedNumbers.value = (nRes || []).filter((n: any) => n.status === 'active' && !assigned.has(n.id));
  } catch (e: any) { toast.err(e?.data?.error?.message || 'Could not load teams'); }
  finally { pending.value = false; }
}

function openCreate() { editing.value = null; form.name = ''; form.description = ''; showModal.value = true; }
function openEdit(d: any) { editing.value = d; form.name = d.name; form.description = d.description || ''; showModal.value = true; }

async function save() {
  saving.value = true;
  try {
    if (editing.value) await api.put(`/api/departments/${editing.value.id}`, { name: form.name, description: form.description });
    else await api.post('/api/departments', { name: form.name, description: form.description });
    showModal.value = false;
    await load();
    toast.ok('Saved');
  } catch (e: any) { toast.err(e?.data?.error?.message || 'Could not save'); }
  finally { saving.value = false; }
}

async function remove(d: any) {
  if (!confirm(`Delete team "${d.name}"? Numbers will be unassigned.`)) return;
  try { await api.del(`/api/departments/${d.id}`); await load(); toast.ok('Deleted'); }
  catch (e: any) { toast.err(e?.data?.error?.message || 'Could not delete'); }
}

async function addMember(d: any) {
  const userId = addUser[d.id];
  if (!userId) return;
  try { await api.post(`/api/departments/${d.id}/members`, { userId }); addUser[d.id] = ''; await load(); }
  catch (e: any) { toast.err(e?.data?.error?.message || 'Could not add'); }
}
async function removeMember(d: any, m: any) {
  try { await api.del(`/api/departments/${d.id}/members`, { userId: m.userId }); await load(); }
  catch (e: any) { toast.err(e?.data?.error?.message || 'Could not remove'); }
}
async function setCap(d: any, m: any, cap: string, ev: Event) {
  const value = (ev.target as HTMLInputElement).checked;
  try { await api.post(`/api/departments/${d.id}/members`, { userId: m.userId, [cap]: value }); m[cap] = value; }
  catch (e: any) { toast.err(e?.data?.error?.message || 'Could not update'); (ev.target as HTMLInputElement).checked = !value; }
}
async function assignNumber(subscriptionId: string, departmentId: string | null) {
  try { await api.post('/api/numbers/assign-department', { subscriptionId, departmentId }); await load(); }
  catch (e: any) { toast.err(e?.data?.error?.message || 'Could not assign'); }
}
async function setRouting(d: any, field: string, ev: Event) {
  const raw = (ev.target as HTMLInputElement | HTMLSelectElement).value;
  const value = field === 'ringTimeout' ? parseInt(raw, 10) : raw;
  try { await api.put(`/api/departments/${d.id}`, { [field]: value }); d[field] = value; toast.ok('Routing updated'); }
  catch (e: any) { toast.err(e?.data?.error?.message || 'Could not update routing'); }
}

onMounted(load);
</script>

<style scoped>
.tm-pagehead { display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; }
.tm-list { display: flex; flex-direction: column; gap: 16px; }
.tm-card { padding: 24px; }
.tm-head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px; }
.tm-name { font-size: 17px; font-weight: 600; }
.tm-desc { font-size: 13px; color: var(--ink-soft); margin-top: 2px; }
.tm-head-actions { display: flex; gap: 12px; }
.tm-link { font-size: 13px; color: var(--ink-soft); }
.tm-link:hover { color: var(--ink); }
.tm-link.danger:hover { color: var(--danger); }
.tm-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 22px; }
@media (max-width: 720px) { .tm-cols { grid-template-columns: 1fr; } }
.tm-col-h { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--ink-mute); margin-bottom: 10px; }
.tm-count { color: var(--ink-soft); }
.tm-member { display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid var(--rule-2); }
.tm-member-id { display: flex; gap: 10px; align-items: center; }
.tm-avatar { width: 30px; height: 30px; border-radius: 50%; background: var(--signal-soft); color: var(--signal); display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 600; }
.tm-member-name { font-size: 13.5px; }
.tm-caps { display: flex; gap: 10px; margin-top: 3px; }
.tm-caps label { font-size: 11px; color: var(--ink-soft); display: flex; align-items: center; gap: 3px; }
.tm-number { display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid var(--rule-2); font-size: 13.5px; }
.tm-x { color: var(--ink-mute); font-size: 12px; }
.tm-x:hover { color: var(--danger); }
.tm-none { font-size: 12.5px; color: var(--ink-mute); padding: 6px 0; }
.tm-add { display: flex; gap: 8px; margin-top: 12px; }
.tm-add .select { flex: 1; }
.modal-overlay { position: fixed; inset: 0; z-index: 200; background: rgba(10,10,11,0.32); display: flex; align-items: center; justify-content: center; padding: 24px; }
.modal { width: 100%; max-width: 420px; background: var(--paper); }
.modal-x { color: var(--ink-mute); font-size: 14px; }
.tm-routing { margin-top: 18px; padding-top: 16px; border-top: 1px solid var(--rule-2); }
.tm-routing-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 13px; color: var(--ink-soft); }
.tm-routing-row .select { width: auto; }
.tm-timeout { width: 64px; }
</style>
