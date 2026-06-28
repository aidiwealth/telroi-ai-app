<template>
  <div class="ad-page">
    <header class="ad-head">
      <div>
        <h1 class="ad-title">Carriers</h1>
        <p class="ad-subtitle">SIP trunks on the Telroi PBX. Saving pushes the trunk config to Asterisk and reloads — no manual config needed. These are shared infrastructure; customers never see them.</p>
      </div>
      <button class="btn btn-signal" @click="openNew">+ Add carrier</button>
    </header>

    <!-- Carrier list -->
    <section class="set-card">
      <div v-if="loading" class="car-empty">Loading carriers…</div>
      <div v-else-if="!carriers.length" class="car-empty">No carriers yet. Click “Add carrier” to create one.</div>
      <table v-else class="car-table">
        <thead>
          <tr><th>Carrier</th><th>Prefix</th><th>Gateway</th><th>Auth</th><th>Status</th><th></th></tr>
        </thead>
        <tbody>
          <tr v-for="c in carriers" :key="c.id">
            <td>
              <span class="car-name">{{ c.displayName }}</span>
              <span class="car-slug mono">{{ c.name }}</span>
            </td>
            <td class="mono">{{ c.prefix }}</td>
            <td class="mono">{{ c.sipGateway }}<span v-if="c.sipPort && c.sipPort !== 5060">:{{ c.sipPort }}</span></td>
            <td>{{ c.authUser ? 'userpass' : 'IP-auth' }}</td>
            <td>
              <span class="set-pill" :class="{ on: c.status === 'live', warn: c.status === 'scaffold', off: !c.enabled }">
                {{ statusLabel(c) }}
              </span>
            </td>
            <td class="car-row-actions">
              <button class="btn btn-ghost btn-sm" @click="edit(c)">Edit</button>
              <button class="btn btn-ghost btn-sm danger" @click="confirmRemove(c)">Remove</button>
            </td>
          </tr>
        </tbody>
      </table>
    </section>

    <!-- Add / Edit form -->
    <section v-if="formOpen" class="set-card">
      <div class="set-card-head">
        <div>
          <h2 class="set-card-title">{{ isEdit ? `Edit ${form.displayName || form.name}` : 'New carrier' }}</h2>
          <p class="set-card-desc">Trunk connection details. On save, Telroi writes the Asterisk config (endpoint, routing, secure caller-ID) and reloads the PBX.</p>
        </div>
      </div>

      <div class="set-grid">
        <div class="ad-field"><label>Name (slug)</label>
          <input v-model="form.name" :disabled="isEdit" class="ad-input mono" placeholder="ruach" />
          <span class="ad-hint">Lowercase letters/numbers only. Permanent once created.</span>
        </div>
        <div class="ad-field"><label>Display name</label>
          <input v-model="form.displayName" class="ad-input" placeholder="Ruach" />
        </div>
        <div class="ad-field"><label>Dial prefix</label>
          <input v-model="form.prefix" class="ad-input mono" placeholder="84" />
          <span class="ad-hint">2–4 digits, unique. Used internally for routing ({{ usedPrefixes }}).</span>
        </div>
        <div class="ad-field"><label>Region</label>
          <input v-model="form.region" class="ad-input mono" placeholder="NG" />
        </div>

        <div class="ad-field"><label>SIP gateway (IP or host)</label>
          <input v-model="form.sipGateway" class="ad-input mono" placeholder="41.222.211.109" />
        </div>
        <div class="ad-field"><label>Port</label>
          <input v-model.number="form.sipPort" type="number" class="ad-input mono" placeholder="5060" />
        </div>
        <div class="ad-field"><label>Transport</label>
          <select v-model="form.transport" class="select">
            <option value="udp">UDP</option><option value="tcp">TCP</option><option value="tls">TLS</option>
          </select>
        </div>
        <div class="ad-field"><label>SIP domain (optional)</label>
          <input v-model="form.sipDomain" class="ad-input mono" placeholder="leave blank to use gateway" />
        </div>

        <div class="ad-field"><label>Auth username (blank if IP-auth)</label>
          <input v-model="form.authUser" class="ad-input mono" placeholder="(none for IP-authenticated)" />
        </div>
        <div class="ad-field"><label>Auth password {{ editingCarrier?.authPassSet ? '· set, blank to keep' : '' }}</label>
          <input v-model="form.authPass" type="password" class="ad-input mono" :placeholder="editingCarrier?.authPassSet ? '••••••••' : '(none for IP-authenticated)'" />
        </div>

        <div class="ad-field"><label>From user / trunk number</label>
          <input v-model="form.fromUser" class="ad-input mono" placeholder="2342094008749" />
        </div>
        <div class="ad-field"><label>Default caller ID (fallback)</label>
          <input v-model="form.callerId" class="ad-input mono" placeholder="2342094008749" />
          <span class="ad-hint">Used only if a customer has no DID on this carrier. Per-customer caller-ID is resolved securely at call time.</span>
        </div>

        <div class="ad-field"><label>Inbound webhook secret {{ editingCarrier?.webhookSecretSet ? '· set, blank to keep' : '' }}</label>
          <input v-model="form.webhookSecret" type="password" class="ad-input mono" :placeholder="editingCarrier?.webhookSecretSet ? '••••••••' : 'shared secret for inbound callbacks'" />
        </div>
        <div class="ad-field car-toggle-field">
          <label class="car-toggle">
            <input type="checkbox" v-model="form.enabled" />
            <span>Enabled (push to PBX)</span>
          </label>
          <span class="ad-hint">Disable to keep the record without an active trunk. Gateways containing “CHANGEME” are saved as scaffolds and not pushed.</span>
        </div>
      </div>

      <div v-if="error" class="car-error">{{ error }}</div>
      <div class="set-actions">
        <button class="btn btn-signal" :disabled="saving || !canSave" @click="save">
          {{ saving ? 'Saving & pushing to PBX…' : (isEdit ? 'Save changes' : 'Create carrier') }}
        </button>
        <button class="btn btn-ghost" :disabled="saving" @click="closeForm">Cancel</button>
        <span v-if="saved" class="ad-saved">✓ {{ savedMsg }}</span>
      </div>
    </section>
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
const formOpen = ref(false);
const isEdit = ref(false);
const editingCarrier = ref<Carrier | null>(null);
const saving = ref(false);
const saved = ref(false);
const savedMsg = ref('');
const error = ref('');

const blankForm = () => ({
  name: '', displayName: '', prefix: '', region: 'NG',
  sipGateway: '', sipPort: 5060, transport: 'udp', sipDomain: '',
  authUser: '', authPass: '', fromUser: '', callerId: '',
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

async function load() {
  loading.value = true;
  try {
    carriers.value = await $fetch<Carrier[]>('/api/admin/carriers');
  } catch (e: any) {
    error.value = e?.data?.error?.message || 'Failed to load carriers';
  } finally {
    loading.value = false;
  }
}

function openNew() {
  Object.assign(form, blankForm());
  const nums = carriers.value.map((c) => parseInt(c.prefix, 10)).filter((n) => !isNaN(n));
  const next = nums.length ? Math.max(...nums) + 1 : 84;
  form.prefix = String(next);
  isEdit.value = false;
  editingCarrier.value = null;
  error.value = '';
  saved.value = false;
  formOpen.value = true;
}

function edit(c: Carrier) {
  Object.assign(form, blankForm());
  form.name = c.name; form.displayName = c.displayName; form.prefix = c.prefix;
  form.region = c.region; form.sipGateway = c.sipGateway; form.sipPort = c.sipPort;
  form.transport = c.transport; form.sipDomain = c.sipDomain || '';
  form.authUser = c.authUser || ''; form.fromUser = c.fromUser || '';
  form.callerId = c.callerId || ''; form.enabled = c.enabled;
  form.authPass = ''; form.webhookSecret = '';
  isEdit.value = true;
  editingCarrier.value = c;
  error.value = '';
  saved.value = false;
  formOpen.value = true;
}

function closeForm() { formOpen.value = false; }

async function save() {
  if (!canSave.value) return;
  saving.value = true;
  saved.value = false;
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
    if (form.fromUser) payload.fromUser = form.fromUser;
    if (form.callerId) payload.callerId = form.callerId;
    if (form.webhookSecret) payload.webhookSecret = form.webhookSecret;

    const r = await $fetch<any>('/api/admin/carriers', { method: 'POST', body: payload });
    savedMsg.value = r.pushed ? 'Saved & pushed to PBX' : 'Saved (not pushed — disabled/scaffold)';
    saved.value = true;
    await load();
    setTimeout(() => { formOpen.value = false; }, 900);
  } catch (e: any) {
    error.value = e?.data?.error?.message || e?.message || 'Save failed';
  } finally {
    saving.value = false;
  }
}

async function confirmRemove(c: Carrier) {
  if (!confirm(`Remove carrier “${c.displayName}”? This deletes its Asterisk config and DB record.`)) return;
  error.value = '';
  try {
    await $fetch(`/api/admin/carriers/${encodeURIComponent(c.name)}`, { method: 'DELETE' });
    await load();
  } catch (e: any) {
    error.value = e?.data?.error?.message || 'Remove failed';
  }
}

onMounted(load);
</script>

<style scoped>
.ad-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; margin-bottom: 20px; }
.ad-subtitle { color: var(--muted, #6b7280); font-size: 13px; max-width: 640px; margin-top: 4px; line-height: 1.5; }
.car-empty { padding: 28px; text-align: center; color: var(--muted, #6b7280); }
.car-table { width: 100%; border-collapse: collapse; }
.car-table th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted, #9ca3af); padding: 8px 12px; border-bottom: 1px solid var(--line, #e5e7eb); }
.car-table td { padding: 12px; border-bottom: 1px solid var(--line, #f1f1f1); font-size: 14px; vertical-align: middle; }
.car-name { font-weight: 600; }
.car-slug { display: block; font-size: 11px; color: var(--muted, #9ca3af); }
.car-row-actions { text-align: right; white-space: nowrap; }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.set-pill.warn { background: #fef3c7; color: #92400e; }
.set-pill.off { background: #f3f4f6; color: #6b7280; }
.car-toggle-field { display: flex; flex-direction: column; gap: 4px; }
.car-toggle { display: flex; align-items: center; gap: 8px; cursor: pointer; font-size: 14px; }
.car-error { color: #c0392b; font-size: 13px; margin: 8px 0; }
.btn-sm.danger { color: #c0392b; }
</style>
