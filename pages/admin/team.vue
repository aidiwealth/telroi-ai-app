<template>
  <div>
    <div class="ad-head">
      <div>
        <h1 class="ad-title">Operator team</h1>
        <p class="ad-sub">People who can sign in to the Telroi operator dashboard. Superadmins manage everything; staff handle day-to-day support.</p>
      </div>
      <button v-if="myRole === 'superadmin'" class="btn btn-signal btn-sm" @click="openAdd">+ Add member</button>
    </div>

    <div v-if="pending" class="ad-loading">Loading…</div>
    <EmptyState v-else-if="!admins.length" icon="agents" title="No operators yet" description="Add a team member so they can sign in to the operator dashboard." />
    <div v-else class="set-card ad-table-wrap">
      <table class="ad-data-table">
        <thead>
          <tr><th>Email</th><th>Role</th><th>Added</th><th></th></tr>
        </thead>
        <tbody>
          <tr v-for="a in admins" :key="a.id">
            <td class="team-email">{{ a.email }}<span v-if="a.email === myEmail" class="team-you">you</span></td>
            <td>
              <select v-if="myRole === 'superadmin' && a.email !== myEmail" :value="a.role" class="team-role-select" @change="changeRole(a, $event)">
                <option value="superadmin">Superadmin</option>
                <option value="staff">Staff</option>
              </select>
              <span v-else class="team-role" :class="a.role">{{ a.role === 'superadmin' ? 'Superadmin' : 'Staff' }}</span>
            </td>
            <td class="ad-dim mono">{{ fmt(a.createdAt) }}</td>
            <td class="ad-r">
              <button v-if="myRole === 'superadmin' && a.email !== myEmail" class="btn btn-ghost btn-xs" :disabled="busy === a.id" @click="remove(a)">Remove</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <p class="team-foot ad-dim">Operators sign in at the operator login with a one-time code sent to their email — no password needed. Add someone here first, then they can sign in.</p>

    <!-- Add member modal -->
    <div v-if="showAdd" class="ad-modal-overlay" @click.self="showAdd = false">
      <div class="ad-modal">
        <div class="ad-modal-head"><h3>Add operator</h3><button class="ad-x" @click="showAdd = false">✕</button></div>
        <div class="ad-field">
          <label>Email</label>
          <input v-model="draft.email" type="email" class="ad-input" placeholder="teammate@telroi.ai" />
        </div>
        <div class="ad-field">
          <label>Role</label>
          <select v-model="draft.role" class="ad-input">
            <option value="staff">Staff — support & day-to-day</option>
            <option value="superadmin">Superadmin — full access</option>
          </select>
        </div>
        <button class="btn btn-signal btn-block" :disabled="adding || !draft.email" @click="add">{{ adding ? 'Adding…' : 'Add to team' }}</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, reactive } from 'vue';
definePageMeta({ layout: 'admin' });
useHead({ title: 'Operator team — Telroi' });

const admins = ref<any[]>([]);
const pending = ref(true);
const myEmail = ref('');
const myRole = ref('staff');
const showAdd = ref(false);
const adding = ref(false);
const busy = ref<string | null>(null);
const draft = reactive({ email: '', role: 'staff' });

function fmt(d: string) { return new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); }

async function load() {
  pending.value = true;
  try {
    const [t, me] = await Promise.all([
      $fetch<any>('/api/admin/team'),
      $fetch<any>('/api/admin/me').catch(() => null)
    ]);
    admins.value = t.admins || [];
    if (me?.admin) { myEmail.value = me.admin.email; myRole.value = me.admin.role; }
  } catch (e: any) {
    if (e?.statusCode === 401) await navigateTo('/admin/login');
  } finally { pending.value = false; }
}
function openAdd() { draft.email = ''; draft.role = 'staff'; showAdd.value = true; }
async function add() {
  adding.value = true;
  try {
    await $fetch('/api/admin/team', { method: 'POST', body: { email: draft.email, role: draft.role } });
    showAdd.value = false;
    await load();
  } catch (e: any) { alert(e?.data?.error?.message || e?.data?.message || 'Could not add'); }
  finally { adding.value = false; }
}
async function changeRole(a: any, ev: Event) {
  const role = (ev.target as HTMLSelectElement).value;
  busy.value = a.id;
  try { await $fetch(`/api/admin/team/${a.id}`, { method: 'PATCH', body: { role } }); await load(); }
  catch (e: any) { alert(e?.data?.error?.message || 'Could not change role'); await load(); }
  finally { busy.value = null; }
}
async function remove(a: any) {
  if (!confirm(`Remove ${a.email} from the operator team?`)) return;
  busy.value = a.id;
  try { await $fetch(`/api/admin/team/${a.id}`, { method: 'DELETE' }); await load(); }
  catch (e: any) { alert(e?.data?.error?.message || 'Could not remove'); }
  finally { busy.value = null; }
}
onMounted(load);
</script>

<style scoped>
.ad-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 22px; }
.team-email { font-weight: 500; }
.team-you { font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--ink-mute); margin-left: 8px; border: 1px solid var(--rule); padding: 1px 6px; border-radius: 4px; }
.team-role { font-size: 12px; padding: 3px 10px; border-radius: 999px; background: var(--paper-3); color: var(--ink-soft); }
.team-role.superadmin { background: var(--signal-soft); color: var(--signal); }
.team-role-select { padding: 6px 10px; border: 1px solid var(--rule); border-radius: var(--radius-sm); font-size: 13px; background: var(--paper); cursor: pointer; }
.team-role-select:focus { outline: none; border-color: var(--signal); }
.btn-xs { padding: 3px 10px; font-size: 11.5px; border-radius: var(--radius-sm); }
.team-foot { font-size: 12.5px; margin-top: 16px; }
.ad-modal-overlay { position: fixed; inset: 0; z-index: 100; background: rgba(10,10,11,0.45); backdrop-filter: blur(3px); display: flex; align-items: center; justify-content: center; padding: 24px; animation: ad-fade 0.16s ease; }
.ad-modal { background: var(--paper); border-radius: var(--radius-lg); border: 1px solid var(--rule); box-shadow: 0 20px 60px rgba(10,10,11,0.25); width: 100%; max-width: 420px; padding: 24px; animation: ad-pop 0.18s cubic-bezier(0.16,1,0.3,1); }
.ad-modal-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
.ad-modal-head h3 { font-family: var(--font-display); font-size: 19px; font-weight: 500; }
.ad-x { width: 30px; height: 30px; border-radius: 8px; color: var(--ink-mute); font-size: 15px; }
.ad-x:hover { background: var(--paper-2); color: var(--ink); }
.ad-field { margin-bottom: 14px; }
.ad-field label { display: block; font-size: 12.5px; color: var(--ink-soft); margin-bottom: 6px; }
.ad-input { width: 100%; padding: 10px 12px; border: 1px solid var(--rule); border-radius: var(--radius); font-size: 14px; background: var(--paper); }
.ad-input:focus { outline: none; border-color: var(--signal); }
@keyframes ad-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes ad-pop { from { opacity: 0; transform: translateY(8px) scale(0.98); } to { opacity: 1; transform: translateY(0) scale(1); } }
</style>
