<template>
  <div>
    <div class="page-head">
      <h1 class="page-title">SIP connectivity</h1>
      <p class="page-sub">Connect your own SIP devices, softphones or PBX to Telroi. Calls over SIP run on the same infrastructure, so they flow through your AI Numbers, agents, departments and routing automatically.</p>
    </div>

    <div v-if="pending" class="loading-pad"><div v-for="i in 2" :key="i" class="skeleton skel-row" /></div>

    <template v-else>
      <div v-if="!data?.available && !data?.endpoints?.length" class="card">
        <EmptyState icon="generic" title="SIP not enabled yet"
          description="SIP connectivity isn't enabled for your account. Contact support if you need direct SIP access." />
      </div>

      <template v-else>
        <!-- Set up (self-serve carriers only: twilio/telnyx) -->
        <div v-if="data.selfServe" class="card sip-setup card-pad">
          <div>
            <h3 class="sip-setup-h">Set up a SIP endpoint</h3>
            <p class="sip-setup-note">We'll create a secure SIP login for your devices. You'll get a server, username and password to configure your softphone or PBX.</p>
          </div>
          <button class="btn btn-signal" :disabled="provisioning" @click="provision">{{ provisioning ? 'Setting up…' : 'Set up SIP' }}</button>
        </div>

        <!-- Endpoints (generic, no vendor identity) -->
        <div class="card sip-card">
          <div class="card-head"><span class="card-title">Your SIP endpoints</span></div>
          <table v-if="data.endpoints.length" class="table">
            <thead><tr><th>SIP server</th><th>Username</th><th>Password</th><th></th></tr></thead>
            <tbody>
              <tr v-for="e in data.endpoints" :key="e.id">
                <td class="mono">{{ e.sipServer || '—' }}<button v-if="e.sipServer" class="sip-copy" @click="copy(e.sipServer)">Copy</button></td>
                <td class="mono">{{ e.sipUsername || '—' }}<button v-if="e.sipUsername" class="sip-copy" @click="copy(e.sipUsername)">Copy</button></td>
                <td class="mono"><template v-if="e.password"><span v-if="shown[e.id]">{{ e.password }}</span><span v-else>••••••••</span><button class="sip-copy" @click="copy(e.password)">Copy</button><button class="sip-copy" @click="shown[e.id] = !shown[e.id]">{{ shown[e.id] ? 'Hide' : 'Show' }}</button></template><span v-else-if="e.hasPassword" class="sip-secret-tag">set at creation</span><span v-else class="muted">—</span></td>
                <td class="row-actions">
                  <button v-if="e.canRouteNumber" class="btn btn-ghost btn-sm" @click="openAttach(e)">Route a number</button>
                  <button class="btn btn-danger btn-sm" @click="remove(e)">Remove</button>
                </td>
              </tr>
            </tbody>
          </table>
          <div v-else class="card-pad"><EmptyState icon="generic" title="No endpoints yet" :description="data.selfServe ? 'Set up a SIP endpoint above to connect your devices.' : 'SIP is arranged by our team for your account. Contact support to have your SIP endpoint set up.'" /></div>
        </div>

        <p class="sip-help muted">Point your SIP device at the server above using the username and password. Need help configuring a specific device? Contact support.</p>
      </template>
    </template>

    <!-- One-time password modal -->
    <div v-if="secret" class="modal-overlay" @click.self="secret = null">
      <div class="modal card">
        <div class="card-head"><span class="card-title">Save your SIP password</span><button class="modal-x" @click="secret = null">✕</button></div>
        <div class="card-pad">
          <p class="sip-secret-warn">This password is shown <strong>once</strong>. Copy it now and store it securely — you won't be able to see it again.</p>
          <div class="sip-secret-box"><code>{{ secret }}</code><button class="sip-copy" @click="copy(secret)">Copy</button></div>
          <button class="btn btn-signal btn-block" @click="secret = null">I've saved it</button>
        </div>
      </div>
    </div>

    <!-- Route a number modal -->
    <div v-if="attachEp" class="modal-overlay" @click.self="attachEp = null">
      <div class="modal card">
        <div class="card-head"><span class="card-title">Route a number over SIP</span><button class="modal-x" @click="attachEp = null">✕</button></div>
        <div class="card-pad">
          <p class="sip-setup-note">Inbound calls to the selected number will be delivered over your SIP endpoint, then flow through your AI routing. Pick one of your numbers below.</p>
          <div v-if="myNumbers.length" class="field-float">
            <select v-model="attachNum" class="input mono" id="att-num">
              <option value="">Select a number…</option>
              <option v-for="n in myNumbers" :key="n.telnum" :value="n.telnum">{{ n.telnum }}</option>
            </select>
          </div>
          <p v-else class="sip-setup-note muted">You don't have any numbers yet. Numbers you purchase will appear here.</p>
          <button class="btn btn-signal btn-block" :disabled="attaching || !attachNum" @click="attachNumber">{{ attaching ? 'Routing…' : 'Route this number' }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
useHead({ title: 'SIP — Telroi' });
const api = useApi();
const toast = useToast();

const pending = ref(true);
const data = ref<any>(null);
const provisioning = ref(false);
const secret = ref<string | null>(null);
const attachEp = ref<any>(null);
const attachNum = ref('');
const attaching = ref(false);
const shown = ref<Record<string, boolean>>({});
const myNumbers = ref<any[]>([]);

async function load() {
  pending.value = true;
  try { data.value = await api.get('/api/voice/sip'); }
  catch (e: any) { toast.err(e.message); }
  finally { pending.value = false; }
}

async function provision() {
  provisioning.value = true;
  try {
    const res = await api.post('/api/voice/sip/provision', {});
    if (res.oneTimeSecret) secret.value = res.oneTimeSecret;
    toast.ok('SIP endpoint ready');
    await load();
  } catch (e: any) { toast.err(e.message); }
  finally { provisioning.value = false; }
}

async function remove(e: any) {
  if (!confirm('Remove this SIP endpoint? Devices using it will stop connecting.')) return;
  try { await api.del(`/api/voice/sip/endpoints/${encodeURIComponent(e.id)}`); toast.ok('Endpoint removed'); await load(); }
  catch (e2: any) { toast.err(e2.message); }
}

async function openAttach(e: any) {
  attachEp.value = e; attachNum.value = '';
  try { myNumbers.value = await api.get('/api/numbers/subscriptions') || []; }
  catch { myNumbers.value = []; }
}
async function attachNumber() {
  attaching.value = true;
  try {
    await api.post(`/api/voice/sip/endpoints/${encodeURIComponent(attachEp.value.id)}/attach-number`, { telnum: attachNum.value });
    toast.ok('Number routed over SIP');
    attachEp.value = null;
    await load();
  } catch (e: any) { toast.err(e.message); }
  finally { attaching.value = false; }
}

async function copy(text: string | null) {
  if (!text) return;
  try { await navigator.clipboard.writeText(text); toast.ok('Copied'); } catch { toast.err('Could not copy'); }
}

onMounted(load);
</script>

<style scoped>
.sip-setup { display: flex; align-items: center; justify-content: space-between; gap: 20px; margin-bottom: 18px; }
.sip-setup-h { font-size: 16px; margin-bottom: 4px; }
.sip-setup-note { font-size: 13px; color: var(--ink-soft); line-height: 1.5; max-width: 60ch; }
.sip-card { overflow: hidden; }
.sip-copy { font-size: 11px; color: var(--signal); padding: 2px 7px; margin-left: 8px; border-radius: var(--radius-sm); border: 1px solid var(--rule); background: var(--paper); }
.sip-copy:hover { border-color: var(--signal); }
.sip-secret-tag { font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; color: #0a8a5c; border: 1px solid var(--rule); padding: 1px 6px; border-radius: 4px; }
.sip-secret-warn { font-size: 13px; color: var(--warn); line-height: 1.5; margin-bottom: 14px; }
.sip-secret-box { display: flex; align-items: center; gap: 8px; background: var(--paper-2); border: 1px solid var(--rule); border-radius: var(--radius); padding: 10px 12px; margin-bottom: 16px; }
.sip-secret-box code { flex: 1; font-size: 14px; word-break: break-all; }
.sip-help { font-size: 12.5px; margin-top: 14px; }
.loading-pad { padding: 16px 24px; display: flex; flex-direction: column; gap: 10px; }
.skel-row { height: 40px; }
.modal-overlay { position: fixed; inset: 0; z-index: 200; background: rgba(10,10,11,0.32); display: flex; align-items: center; justify-content: center; padding: 24px; }
.modal { width: 100%; max-width: 440px; background: var(--paper); }
.modal-x { color: var(--ink-mute); }
</style>
