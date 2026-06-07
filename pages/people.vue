<template>
  <div>
    <div class="page-head ppl-pagehead">
      <div>
        <h1 class="page-title">People</h1>
        <p class="page-sub">Everyone on your workspace — their dashboard access and whether they can make and take calls.</p>
      </div>
      <button v-if="canManage" class="btn btn-signal btn-sm" @click="openInvite">+ Invite person</button>
    </div>

    <div class="card ppl-table">
      <div v-if="pending" class="loading-pad"><div v-for="i in 4" :key="i" class="skeleton skel-row" /></div>
      <table v-else-if="people.length" class="table">
        <thead>
          <tr><th>Person</th><th>Dashboard role</th><th>Calling</th><th>Status</th><th v-if="canManage"></th></tr>
        </thead>
        <tbody>
          <tr v-for="p in people" :key="p.email">
            <td>
              <div class="ppl-id">
                <span class="ppl-avatar">{{ initials(p) }}</span>
                <div>
                  <div class="ppl-name">{{ p.name || p.email }}</div>
                  <div class="ppl-email mono">{{ p.email }}</div>
                </div>
              </div>
            </td>
            <td>
              <select v-if="canManage && p.role !== 'owner' && p.email !== youEmail" class="select select-sm" :value="p.role" @change="changeRole(p, $event)">
                <option value="admin">admin</option>
                <option value="member">member</option>
              </select>
              <span v-else class="chip">{{ p.role }}</span>
            </td>
            <td>
              <span v-if="p.extension" class="ppl-ext"><span class="ag-dot on" /> Extension {{ p.extension }}</span>
              <button v-else-if="canManage" class="ppl-setup" @click="setupCalling(p)">Set up calling</button>
              <span v-else class="muted">No extension</span>
            </td>
            <td><span class="chip" :class="p.online ? 'chip--ok' : ''">{{ p.online ? 'online' : 'offline' }}</span></td>
            <td v-if="canManage">
              <button v-if="p.role !== 'owner' && p.email !== youEmail" class="ppl-remove" @click="removePerson(p)" title="Remove">✕</button>
            </td>
          </tr>
        </tbody>
      </table>
      <EmptyState v-else icon="team" title="No people yet" description="Invite teammates to give them dashboard access and calling." />
    </div>

    <p class="ppl-foot muted">Dashboard role controls login access (owners &amp; admins manage settings). “Calling” is a person’s phone extension — set it up to let them make and take calls.</p>

    <!-- Invite -->
    <div v-if="showInvite" class="modal-overlay" @click.self="showInvite = false">
      <div class="modal card">
        <div class="card-head"><span class="card-title">Invite person</span><button class="modal-x" @click="showInvite = false">✕</button></div>
        <div class="card-pad">
          <div class="field"><label>Email</label><input v-model="inviteEmail" class="input" placeholder="name@company.com" /></div>
          <div class="field"><label>Role</label><select v-model="inviteRole" class="select"><option value="member">member</option><option value="admin">admin</option></select></div>
          <button class="btn btn-signal btn-block" :disabled="inviting || !inviteEmail" @click="invite">{{ inviting ? 'Sending…' : 'Send invite' }}</button>
        </div>
      </div>
    </div>

    <!-- Set up calling -->
    <div v-if="showSetup" class="modal-overlay" @click.self="showSetup = false">
      <div class="modal card">
        <div class="card-head"><span class="card-title">Set up calling</span><button class="modal-x" @click="showSetup = false">✕</button></div>
        <div class="card-pad">
          <p class="muted" style="margin-bottom:14px">Give {{ setupPerson?.name || setupPerson?.email }} a phone extension so they can make and take calls.</p>
          <div class="field"><label>Username (login)</label><input v-model="setupLogin" class="input mono" placeholder="e.g. jane" /></div>
          <button class="btn btn-signal btn-block" :disabled="settingUp || !setupLogin" @click="doSetup">{{ settingUp ? 'Creating…' : 'Create extension' }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useAuthStore } from '~/stores/auth';
import type { TelroiUser } from '~/server/utils/telroi/client';

const api = useApi();
const toast = useToast();
const auth = useAuthStore();

const youEmail = computed(() => auth.user?.email || '');
const canManage = computed(() => { const r = (auth.user as any)?.role; return r === 'owner' || r === 'admin'; });

interface Person { email: string; name?: string; role: string; userId?: string; extension?: string; online?: boolean; }
const people = ref<Person[]>([]);
const pending = ref(true);

const showInvite = ref(false);
const inviteEmail = ref('');
const inviteRole = ref('member');
const inviting = ref(false);

const showSetup = ref(false);
const setupPerson = ref<Person | null>(null);
const setupLogin = ref('');
const settingUp = ref(false);

function initials(p: Person) { return ((p.name || p.email || '?').trim()[0] || '?').toUpperCase(); }

async function load() {
  pending.value = true;
  try {
    const [mRes, aRes] = await Promise.all([
      api.get<any>('/api/tenant/members'),
      api.get<{ items: TelroiUser[] }>('/api/voice/agents').catch(() => ({ items: [] }))
    ]);
    const members = (mRes.members || mRes || []);
    const agents = (aRes.items || []);
    // Join: a member's calling extension is the agent whose login/email matches.
    people.value = members.map((m: any) => {
      // Prefer the explicit stored link (memberships.pbxLogin); fall back to an
      // email/login match only for people linked before the explicit link existed.
      const agent = agents.find((a) =>
        (m.pbxLogin && a.login === m.pbxLogin) ||
        (!m.pbxLogin && ((a.email && a.email === m.email) || a.login === m.email?.split('@')[0]))
      );
      return {
        email: m.email, name: m.name, role: m.role, userId: m.userId,
        extension: agent?.ext || agent?.login || (m.pbxLogin || undefined),
        online: agent?.status === 'online'
      };
    });
  } catch (e: any) { toast.err(e?.data?.error?.message || 'Could not load people'); }
  finally { pending.value = false; }
}

function openInvite() { inviteEmail.value = ''; inviteRole.value = 'member'; showInvite.value = true; }
async function invite() {
  inviting.value = true;
  try { await api.post('/api/tenant/members', { email: inviteEmail.value, role: inviteRole.value }); showInvite.value = false; await load(); toast.ok('Invite sent'); }
  catch (e: any) { toast.err(e?.data?.error?.message || 'Could not invite'); }
  finally { inviting.value = false; }
}
async function changeRole(p: Person, ev: Event) {
  const role = (ev.target as HTMLSelectElement).value;
  try { await api.patch(`/api/tenant/members/${encodeURIComponent(p.email)}`, { role }); p.role = role; toast.ok('Role updated'); }
  catch (e: any) { toast.err(e?.data?.error?.message || 'Could not update'); }
}
async function removePerson(p: Person) {
  if (!confirm(`Remove ${p.name || p.email} from this workspace?`)) return;
  try { await api.del(`/api/tenant/members/${encodeURIComponent(p.email)}`); await load(); }
  catch (e: any) { toast.err(e?.data?.error?.message || 'Could not remove'); }
}
function setupCalling(p: Person) { setupPerson.value = p; setupLogin.value = (p.email || '').split('@')[0]; showSetup.value = true; }
async function doSetup() {
  settingUp.value = true;
  try {
    await api.post('/api/voice/agents', { login: setupLogin.value, name: setupPerson.value?.name, email: setupPerson.value?.email });
    showSetup.value = false; await load(); toast.ok('Extension created');
  } catch (e: any) { toast.err(e?.data?.error?.message || 'Could not create extension'); }
  finally { settingUp.value = false; }
}

onMounted(load);
</script>

<style scoped>
.ppl-table { padding: 0; overflow: hidden; }
.ppl-pagehead { display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; }
.loading-pad { padding: 20px; }
.ppl-id { display: flex; gap: 10px; align-items: center; }
.ppl-avatar { width: 32px; height: 32px; border-radius: 50%; background: var(--signal-soft); color: var(--signal); display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 600; }
.ppl-name { font-size: 14px; }
.ppl-email { font-size: 12px; color: var(--ink-mute); }
.select-sm { padding: 4px 8px; font-size: 12.5px; }
.ppl-ext { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; }
.ag-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--ink-mute); display: inline-block; }
.ag-dot.on { background: var(--live); }
.ppl-setup { font-size: 12.5px; color: var(--signal); }
.ppl-setup:hover { text-decoration: underline; }
.ppl-remove { color: var(--ink-mute); font-size: 12px; }
.ppl-remove:hover { color: var(--danger); }
.ppl-foot { font-size: 12px; margin-top: 14px; max-width: 620px; }
.modal-overlay { position: fixed; inset: 0; z-index: 200; background: rgba(10,10,11,0.32); display: flex; align-items: center; justify-content: center; padding: 24px; }
.modal { width: 100%; max-width: 420px; background: var(--paper); }
.modal-x { color: var(--ink-mute); font-size: 14px; }
</style>
