<template>
  <div class="ad-page">
    <header class="car-head">
      <div>
        <h1 class="car-title">Carriers</h1>
        <p class="car-lede">SIP trunks on the Telroi PBX. Saving writes the Asterisk config and reloads automatically — no manual edits. Shared infrastructure; customers never see these.</p>
      </div>
      <button class="btn btn-signal" @click="openNew">+ Add carrier</button>
    </header>

    <section class="car-card">
      <div v-if="loading" class="car-empty">Loading carriers…</div>
      <div v-else-if="loadError" class="car-empty car-empty-err">{{ loadError }}</div>
      <div v-else-if="!carriers.length" class="car-empty">No carriers yet. Click “Add carrier” to create one.</div>
      <table v-else class="car-table">
        <thead>
          <tr><th>Carrier</th><th>Prefix</th><th>Gateway</th><th>Auth</th><th>Status</th><th></th></tr>
        </thead>
        <tbody>
          <tr v-for="c in carriers" :key="c.id">
            <td>
              <span class="car-name">{{ c.displayName }}</span>
              <span class="car-slug">{{ c.name }}</span>
            </td>
            <td class="mono">{{ c.prefix }}</td>
            <td class="mono car-gw">{{ c.sipGateway }}<span v-if="c.sipPort && c.sipPort !== 5060">:{{ c.sipPort }}</span></td>
            <td class="car-auth">{{ c.authUser ? 'userpass' : 'IP-auth' }}</td>
            <td><span class="car-pill" :class="pillClass(c)">{{ statusLabel(c) }}</span></td>
            <td class="car-actions">
              <button class="car-link" @click="edit(c)">Edit</button>
              <button class="car-link car-link-danger" @click="remove(c)">Remove</button>
            </td>
          </tr>
        </tbody>
      </table>
    </section>

    <div v-if="modalOpen" class="ad-modal-overlay" @click.self="closeModal">
      <div class="ad-modal ad-modal-wide">
        <div class="ad-modal-head">
          <h3>{{ isEdit ? `Edit ${editingCarrier?.displayName || form.name}` : 'Add carrier' }}</h3>
          <button class="ad-x" @click="closeModal">✕</button>
        </div>
        <p class="car-modal-lede">On save, Telroi writes the trunk config (endpoint, routing, secure caller-ID) to the PBX and reloads Asterisk.</p>

        <div class="car-form-grid">
          <div class="ad-field">
            <label>Name (slug)</label>
            <input v-model="form.name" :disabled="isEdit" class="ad-input mono" placeholder="ruach" />
            <span class="ad-hint">Lowercase letters/numbers. Permanent once created.</span>
          </div>
          <div class="ad-field">
            <label>Display name</label>
            <input v-model="form.displayName" class="ad-input" placeholder="Ruach" />
          </div>
          <div class="ad-field">
            <label>Dial prefix</label>
            <input v-model="form.prefix" class="ad-input mono" placeholder="84" />
            <span class="ad-hint">2–4 digits, unique ({{ usedPrefixes }}).</span>
          </div>
          <div class="ad-field">
            <label>Region</label>
            <input v-model="form.region" class="ad-input mono" placeholder="NG" />
          </div>

          <div class="ad-field">
            <label>SIP gateway (IP or host)</label>
            <input v-model="form.sipGateway" class="ad-input mono" placeholder="41.222.211.109" />
          </div>
          <div class="ad-field">
            <label>Port</label>
            <input v-model.number="form.sipPort" type="number" class="ad-input mono" placeholder="5060" />
          </div>
          <div class="ad-field">
            <label>Transport</label>
            <select v-model="form.transport" class="ad-input">
              <option value="udp">UDP</option><option value="tcp">TCP</option><option value="tls">TLS</option>
            </select>
          </div>
          <div class="ad-field">
            <label>SIP domain (optional)</label>
            <input v-model="form.sipDomain" class="ad-input mono" placeholder="blank = use gateway" />
          </div>

          <div class="ad-field">
            <label>Auth username</label>
            <input v-model="form.authUser" class="ad-input mono" placeholder="blank for IP-auth" />
          </div>
          <div class="ad-field">
            <label>Auth password {{ editingCarrier?.authPassSet ? '· set' : '' }}</label>
            <input v-model="form.authPass" type="password" class="ad-input mono" :placeholder="editingCarrier?.authPassSet ? '•••••••• (blank to keep)' : 'blank for IP-auth'" />
          </div>

          <div class="ad-field car-span2">
            <label>Inbound webhook secret {{ editingCarrier?.webhookSecretSet ? '· set' : '' }}</label>
            <input v-model="form.webhookSecret" type="password" class="ad-input mono" :placeholder="editingCarrier?.webhookSecretSet ? '•••••••• (blank to keep)' : 'shared secret for inbound callbacks'" />
          </div>

          <div class="ad-field car-span2 car-toggle-row">
            <label class="car-toggle">
              <input type="checkbox" v-model="form.enabled" />
              <span>Enabled — push trunk to PBX</span>
            </label>
            <span class="ad-hint">Off keeps the record without an active trunk. Gateways with “CHANGEME” save as scaffolds (not pushed).</span>
          </div>
        </div>

        <div v-if="error" class="car-form-error">{{ error }}</div>

        <div class="ad-modal-foot">
          <button class="btn btn-ghost" :disabled="saving" @click="closeModal">Cancel</button>
          <button class="btn btn-signal" :disabled="saving || !canSave" @click="save">
            {{ saving ? 'Saving…' : (isEdit ? 'Save changes' : 'Create carrier') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue';
definePageMeta({ layout: 'admin', middleware: 'superadmin' });

interface Carrier {
  id: string; name: string; displayName: string; prefix: string; region: string;
  sipGateway: string; sipPort: number; transport: string; sipDomain?: string | null;
  authUser?: string | null; fromUser?: string | null; callerId?: string | null;
  codecs?: string[]; enabled: boolean; status: string; pushedAt?: string | null;
  authPassSet?: boolean; webhookSecretSet?: boolean;
}

const carriers = ref<Carrier[]>([]);
const loading = ref(true);
const loadError = ref('');
const modalOpen = ref(false);
const isEdit = ref(false);
const editingCarrier = ref<Carrier | null>(null);
const saving = ref(false);
const error = ref('');

const blankForm = () => ({
  name: '', displayName: '', prefix: '', region: 'NG',
  sipGateway: '', sipPort: 5060, transport: 'udp', sipDomain: '',
  authUser: '', authPass: '',
  webhookSecret: '', enabled: true
});
const form = reactive(blankForm());

const usedPrefixes = computed(() => {
  const used = carriers.value.map((c) => c.prefix).sort();
  return used.length ? `in use: ${used.join(', ')}` : 'none yet';
});
const canSave = computed(() =>
  /^[a-z0-9]{2,32}$/.test(form.name) &&
  form.displayName.trim().length > 0 &&
  /^[0-9]{2,4}$/.test(form.prefix) &&
  form.sipGateway.trim().length > 0
);

function statusLabel(c: Carrier): string {
  if (!c.enabled) return 'Disabled';
  if (c.status === 'scaffold') return 'Scaffold';
  if (c.status === 'live') return 'Live';
  return c.status || 'Unknown';
}
function pillClass(c: Carrier) {
  return { live: c.enabled && c.status === 'live', scaffold: c.status === 'scaffold', off: !c.enabled };
}

async function load() {
  loading.value = true;
  loadError.value = '';
  try {
    carriers.value = await $fetch<Carrier[]>('/api/admin/carriers');
  } catch (e: any) {
    loadError.value = e?.data?.message || e?.data?.error?.message || 'Failed to load carriers';
  } finally {
    loading.value = false;
  }
}

function openNew() {
  Object.assign(form, blankForm());
  const nums = carriers.value.map((c) => parseInt(c.prefix, 10)).filter((n) => !isNaN(n));
  form.prefix = String(nums.length ? Math.max(...nums) + 1 : 84);
  isEdit.value = false;
  editingCarrier.value = null;
  error.value = '';
  modalOpen.value = true;
}

function edit(c: Carrier) {
  Object.assign(form, blankForm());
  form.name = c.name; form.displayName = c.displayName; form.prefix = c.prefix;
  form.region = c.region; form.sipGateway = c.sipGateway; form.sipPort = c.sipPort;
  form.transport = c.transport; form.sipDomain = c.sipDomain || '';
  form.authUser = c.authUser || ''; form.enabled = c.enabled;
  form.authPass = ''; form.webhookSecret = '';
  isEdit.value = true;
  editingCarrier.value = c;
  error.value = '';
  modalOpen.value = true;
}

function closeModal() { if (!saving.value) modalOpen.value = false; }

async function save() {
  if (!canSave.value) return;
  saving.value = true;
  error.value = '';
  try {
    const payload: any = {
      name: form.name, displayName: form.displayName, prefix: form.prefix,
      region: form.region, sipGateway: form.sipGateway, sipPort: form.sipPort,
      transport: form.transport, enabled: form.enabled
    };
    if (form.sipDomain) payload.sipDomain = form.sipDomain;
    if (form.authUser) payload.authUser = form.authUser;
    if (form.authPass) payload.authPass = form.authPass;
    if (form.webhookSecret) payload.webhookSecret = form.webhookSecret;

    await $fetch<any>('/api/admin/carriers', { method: 'POST', body: payload });
    await load();
    modalOpen.value = false;
  } catch (e: any) {
    error.value = e?.data?.message || e?.data?.error?.message || e?.message || 'Save failed';
  } finally {
    saving.value = false;
  }
}

async function remove(c: Carrier) {
  if (!confirm(`Remove carrier “${c.displayName}”? This deletes its Asterisk config and DB record.`)) return;
  try {
    await $fetch(`/api/admin/carriers/${encodeURIComponent(c.name)}`, { method: 'DELETE' });
    await load();
  } catch (e: any) {
    alert(e?.data?.message || e?.data?.error?.message || 'Remove failed');
  }
}

onMounted(load);
</script>

<style scoped>
.car-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 20px; margin-bottom: 24px; }
.car-title { font-family: var(--font-display); font-size: 28px; }
.car-lede { color: var(--ink-soft); font-size: 13.5px; max-width: 600px; margin-top: 6px; line-height: 1.55; }
.car-card { background: var(--paper); border: 1px solid var(--rule); border-radius: var(--radius-lg); overflow: hidden; }
.car-empty { padding: 40px; text-align: center; color: var(--ink-mute); font-size: 14px; }
.car-empty-err { color: var(--danger); }
.car-table { width: 100%; border-collapse: collapse; }
.car-table thead th { text-align: left; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .05em; color: var(--ink-mute); padding: 14px 18px; border-bottom: 1px solid var(--rule); background: var(--paper-2); }
.car-table tbody td { padding: 16px 18px; border-bottom: 1px solid var(--rule); font-size: 14px; vertical-align: middle; }
.car-table tbody tr:last-child td { border-bottom: none; }
.car-name { font-weight: 600; display: block; }
.car-slug { display: block; font-size: 11.5px; color: var(--ink-mute); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; margin-top: 2px; }
.car-gw { color: var(--ink-soft); }
.car-auth { font-size: 13px; color: var(--ink-soft); }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.car-pill { display: inline-block; padding: 3px 10px; border-radius: 999px; font-size: 11.5px; font-weight: 600; background: var(--paper-2); color: var(--ink-mute); }
.car-pill.live { background: color-mix(in srgb, var(--live) 16%, transparent); color: var(--live); }
.car-pill.scaffold { background: #fef3c7; color: #92400e; }
.car-pill.off { background: var(--paper-2); color: var(--ink-mute); }
.car-actions { text-align: right; white-space: nowrap; }
.car-link { font-size: 13px; color: var(--signal); padding: 4px 8px; }
.car-link:hover { text-decoration: underline; }
.car-link-danger { color: var(--danger); }
.ad-modal-overlay { position: fixed; inset: 0; z-index: 200; background: rgba(0,0,0,0.55); display: flex; align-items: center; justify-content: center; padding: 24px; }
.ad-modal { width: 100%; max-width: 460px; background: var(--paper); border-radius: var(--radius-lg); padding: 28px; max-height: 90vh; overflow-y: auto; }
.ad-modal-wide { max-width: 680px; }
.ad-modal-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
.ad-modal-head h3 { font-family: var(--font-display); font-size: 22px; }
.ad-x { color: var(--ink-mute); font-size: 16px; padding: 4px; }
.ad-x:hover { color: var(--ink); }
.car-modal-lede { font-size: 12.5px; color: var(--ink-soft); line-height: 1.5; margin-bottom: 20px; }
.car-form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px 16px; }
.car-span2 { grid-column: 1 / -1; }
.ad-field { display: flex; flex-direction: column; gap: 6px; }
.ad-field label { font-size: 13px; font-weight: 500; color: var(--ink); }
.ad-input { padding: 10px 13px; border: 1px solid var(--rule); border-radius: var(--radius); font-size: 14px; outline: none; background: var(--paper); color: var(--ink); width: 100%; }
.ad-input:focus { border-color: var(--signal); box-shadow: 0 0 0 3px var(--signal-soft); }
.ad-input:disabled { background: var(--paper-2); color: var(--ink-mute); }
.ad-hint { font-size: 12px; color: var(--ink-mute); line-height: 1.4; }
.car-toggle-row { gap: 8px; }
.car-toggle { display: flex; align-items: center; gap: 9px; cursor: pointer; font-size: 14px; font-weight: 500; }
.car-toggle input { width: 16px; height: 16px; cursor: pointer; }
.car-form-error { margin-top: 16px; padding: 11px 14px; background: color-mix(in srgb, var(--danger) 10%, transparent); border: 1px solid color-mix(in srgb, var(--danger) 30%, transparent); border-radius: var(--radius); color: var(--danger); font-size: 13px; }
.ad-modal-foot { display: flex; justify-content: flex-end; gap: 12px; margin-top: 24px; padding-top: 20px; border-top: 1px solid var(--rule); }
@media (max-width: 560px) { .car-form-grid { grid-template-columns: 1fr; } }
</style>
