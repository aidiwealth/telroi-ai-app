<template>
  <div>
    <div class="page-head">
      <h1 class="page-title">SIP connectivity</h1>
    </div>

    <nav class="sip-tabs">
      <button v-for="t in sipTabs" :key="t.id" class="sip-tab" :class="{ on: tab === t.id }" @click="tab = t.id">{{ t.label }}</button>
    </nav>

    <div v-if="pending" class="loading-pad"><div v-for="i in 2" :key="i" class="skeleton skel-row" /></div>

    <template v-else>
      <div v-if="!data?.available && !data?.endpoints?.length" class="card">
        <EmptyState icon="generic" title="SIP not enabled yet"
          description="SIP connectivity isn't enabled for your account. Contact support if you need direct SIP access." />
      </div>

      <template v-else>
        <!-- Set up (self-serve carriers only: twilio/telnyx) -->
        <div v-if="tab === 'auth' && data.selfServe" class="card sip-setup card-pad">
          <div>
            <h3 class="sip-setup-h">Set up a SIP endpoint</h3>
            <p class="sip-setup-note">We'll create a secure SIP login for your devices. You'll get a server, username and password to configure your softphone or PBX.</p>
          </div>
          <button class="btn btn-signal" :disabled="provisioning" @click="provision">{{ provisioning ? 'Setting up…' : 'Set up SIP' }}</button>
        </div>

        <!-- Endpoints (generic, no vendor identity) -->
        <div v-if="tab === 'auth'" class="card sip-card">
          <div class="card-head">
            <span class="card-title">Your SIP endpoints</span>
            <button class="btn btn-ghost btn-sm" :disabled="statusLoading" @click="loadStatus">{{ statusLoading ? 'Checking…' : 'Refresh status' }}</button>
          </div>
          <table v-if="data.endpoints.length" class="table">
            <thead><tr><th>Status</th><th>SIP server</th><th>Username</th><th>Password</th><th></th></tr></thead>
            <tbody>
              <tr v-for="e in data.endpoints" :key="e.id">
                <td>
                  <span class="reg-dot" :class="regClass(e)" :title="regTitle(e)"></span>
                  <span class="reg-label">{{ regLabel(e) }}</span>
                  <span v-if="statusOf(e)?.rttMs != null" class="reg-rtt">{{ statusOf(e).rttMs }}ms</span>
                </td>
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

        <p v-if="tab === 'auth'" class="sip-help muted">Point your SIP device at the server above using the username and password. Need help configuring a specific device? Contact support.</p>

        <!-- IP authentication. At volume, a password on every call is the thing
             that breaks first — carriers interconnect by address instead. Both
             halves are shown, because half a firewall rule is a day lost. -->
        <div v-if="tab === 'ip'" class="card sip-card">
          <div class="card-head"><span class="card-title">SIP via IP address</span></div>
          <div class="card-pad">
            <p class="sip-setup-note">For higher volumes you can connect without a username and password: we trust traffic from your address, you trust ours. Nothing to register, nothing to expire.</p>

            <h4 class="sipip-h">Permit these on your side</h4>
            <table class="table sipip-table">
              <tbody>
                <tr><td>SIP server</td><td class="mono">{{ ipData?.ours?.host }}<button class="sip-copy" @click="copy(ipData.ours.host)">Copy</button></td></tr>
                <tr><td>IP address</td><td class="mono">{{ ipData?.ours?.ip }}<button class="sip-copy" @click="copy(ipData.ours.ip)">Copy</button></td></tr>
                <tr><td>Port</td><td class="mono">{{ ipData?.ours?.port }} ({{ ipData?.ours?.transport }})</td></tr>
                <tr><td>Media ports</td><td class="mono">{{ ipData?.ours?.rtpRange }} UDP</td></tr>
                <tr><td>Codecs</td><td>{{ ipData?.ours?.codecs }}</td></tr>
                <tr><td>Number format</td><td>{{ ipData?.ours?.format }}</td></tr>
              </tbody>
            </table>

            <h4 class="sipip-h">Tell us your address</h4>
            <p class="sip-setup-note">The public address your PBX sends from — not the one it listens on. If you're unsure, send us a test call and we'll tell you what we see arriving.</p>
            <div class="sipip-form">
              <input v-model="ipForm.ipAddress" class="input mono" placeholder="102.89.14.7" />
              <input v-model="ipForm.note" class="input" placeholder="Which site or system this is (optional)" />
              <button class="btn btn-signal" :disabled="ipSubmitting || !ipForm.ipAddress" @click="submitIp">{{ ipSubmitting ? 'Sending…' : 'Request access' }}</button>
            </div>

            <table v-if="ipData?.requests?.length" class="table sipip-table">
              <thead><tr><th>Address</th><th>Status</th><th>Requested</th><th></th></tr></thead>
              <tbody>
                <tr v-for="r in ipData.requests" :key="r.id">
                  <td class="mono">{{ r.ipAddress }}</td>
                  <td>
                    <span class="sipip-badge" :class="r.status">{{ r.status }}</span>
                    <span v-if="r.rejectReason" class="muted"> — {{ r.rejectReason }}</span>
                  </td>
                  <td class="muted">{{ new Date(r.createdAt).toLocaleDateString() }}</td>
                  <td class="ta-r">
                    <button class="btn btn-ghost btn-sm" :disabled="ipRemoving === r.id" @click="removeIp(r)">
                      {{ ipRemoving === r.id ? 'Removing…' : (r.status === 'approved' ? 'Revoke' : 'Withdraw') }}
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
            <p v-else class="muted sipip-empty">No addresses requested yet.</p>
          </div>
        </div>
      </template>
    </template>

    <div v-if="removingEp" class="modal-overlay" @click.self="removingEp = null">
      <div class="modal card">
        <div class="card-head"><span class="card-title">Remove this endpoint?</span><button class="modal-x" @click="removingEp = null">✕</button></div>
        <div class="card-pad">
          <p class="sipip-modal-p">Any device using <strong class="mono">{{ removingEp.sipUsername }}</strong> will stop connecting. You can set up a new endpoint afterwards, but it will have different credentials.</p>
          <button class="btn btn-danger btn-block" @click="confirmRemoveEp">Remove it</button>
        </div>
      </div>
    </div>

    <!-- Withdrawing an address. Worth a proper modal: for an approved one this
         is the only way access ends, and a browser dialog understates that. -->
    <div v-if="removingIp" class="modal-overlay" @click.self="removingIp = null">
      <div class="modal card">
        <div class="card-head">
          <span class="card-title">{{ removingIp.status === 'approved' ? 'Stop trusting this address?' : 'Withdraw this request?' }}</span>
          <button class="modal-x" @click="removingIp = null">✕</button>
        </div>
        <div class="card-pad">
          <p v-if="removingIp.status === 'approved'" class="sipip-modal-p">
            Calls from <strong class="mono">{{ removingIp.ipAddress }}</strong> will be refused straight away. There is no password here, so removing it is how access ends — you can request it again later.
          </p>
          <p v-else class="sipip-modal-p">
            <strong class="mono">{{ removingIp.ipAddress }}</strong> hasn't been approved yet. Withdrawing simply removes the request.
          </p>
          <button class="btn btn-danger btn-block" :disabled="ipRemoving === removingIp.id" @click="confirmRemoveIp">
            {{ ipRemoving === removingIp.id ? 'Removing…' : (removingIp.status === 'approved' ? 'Stop trusting it' : 'Withdraw') }}
          </button>
        </div>
      </div>
    </div>

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
import { ref, reactive, onMounted } from 'vue';
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

const statusById = ref<Record<string, any>>({});
const statusLoading = ref(false);
function statusOf(e: any) { return statusById.value[e.id]; }
function regClass(e: any) {
  const st = statusOf(e);
  if (st && !st.registrable) return 'reg-na';
  if (!st) return 'reg-unknown';
  return st.registered ? 'reg-on' : 'reg-off';
}
function regLabel(e: any) {
  const st = statusOf(e);
  if (st && !st.registrable) return 'Trunk';
  if (!st) return 'Unknown';
  return st.registered ? 'Registered' : 'Offline';
}
function regTitle(e: any) {
  const st = statusOf(e);
  if (st && !st.registrable) return 'Carrier trunk — does not register to Telroi directly.';
  if (!st) return 'Status not loaded yet.';
  if (st.registered) return `Connected${st.via ? ' from ' + st.via : ''}${st.rttMs != null ? ' · ' + st.rttMs + 'ms' : ''}.`;
  return 'No device is currently registered. Open your softphone or browser dialer to connect.';
}
async function loadStatus() {
  statusLoading.value = true;
  try {
    const res = await api.get('/api/voice/sip/status');
    const map = {};
    for (const st of res.endpoints || []) map[st.id] = st;
    statusById.value = map;
  } catch { /* unknown */ }
  finally { statusLoading.value = false; }
}

async function load() {
  pending.value = true;
  try { data.value = await api.get('/api/voice/sip'); }
  catch (e: any) { toast.err(e.message); }
  finally { pending.value = false; }
  if (data.value?.endpoints?.length) loadStatus();
  loadIp();
}

const sipTabs = [
  { id: 'auth', label: 'SIP endpoints' },
  { id: 'ip', label: 'SIP via IP address' }
];
const tab = ref('auth');

const ipData = ref<any>(null);
const ipForm = reactive({ ipAddress: '', note: '' });
const ipSubmitting = ref(false);
const ipRemoving = ref<string | null>(null);

const removingIp = ref<any>(null);
function removeIp(r: any) { removingIp.value = r; }

async function confirmRemoveIp() {
  const r = removingIp.value;
  ipRemoving.value = r.id;
  try {
    await api.del(`/api/voice/sip/ip/${encodeURIComponent(r.id)}`);
    toast.ok(r.status === 'approved' ? 'Access withdrawn' : 'Request withdrawn');
    removingIp.value = null;
    await loadIp();
  } catch (e: any) { toast.err(e.message); }
  finally { ipRemoving.value = null; }
}

async function loadIp() {
  try { ipData.value = await api.get('/api/voice/sip/ip'); }
  catch { /* the rest of the page is still worth showing */ }
}

async function submitIp() {
  ipSubmitting.value = true;
  try {
    await api.post('/api/voice/sip/ip', { ipAddress: ipForm.ipAddress.trim(), note: ipForm.note.trim() || undefined });
    ipForm.ipAddress = ''; ipForm.note = '';
    toast.ok('Sent — we will confirm once it is approved');
    await loadIp();
  } catch (e: any) { toast.err(e.message); }
  finally { ipSubmitting.value = false; }
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

const removingEp = ref<any>(null);
function remove(e: any) { removingEp.value = e; }

async function confirmRemoveEp() {
  const e = removingEp.value;
  try {
    await api.del(`/api/voice/sip/endpoints/${encodeURIComponent(e.id)}`);
    toast.ok('Endpoint removed');
    removingEp.value = null;
    await load();
  } catch (e2: any) { toast.err(e2.message); }
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
.sip-tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--rule); margin-bottom: 22px; flex-wrap: wrap; }
.sip-tab { padding: 10px 16px; font-size: 14px; color: var(--ink-soft); border-bottom: 2px solid transparent; margin-bottom: -1px; background: none; border-left: 0; border-right: 0; border-top: 0; cursor: pointer; transition: color .14s, border-color .14s; }
.sip-tab:hover { color: var(--ink); }
.sip-tab.on { color: var(--signal); border-bottom-color: var(--signal); font-weight: 500; }
.sipip-h { font-size: 13px; text-transform: uppercase; letter-spacing: .04em; color: var(--ink-soft); margin: 20px 0 8px; }
.sipip-table td:first-child { color: var(--ink-soft); width: 160px; }
.sipip-form { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; }
.sipip-form .input { flex: 1; min-width: 180px; }
.sipip-badge { font-size: 11.5px; padding: 2px 8px; border-radius: 999px; background: var(--paper-2); color: var(--ink-soft); text-transform: capitalize; }
.sipip-badge.approved { background: rgba(34,139,84,.12); color: #1c7a49; }
.sipip-badge.rejected { background: rgba(180,45,45,.12); color: #a33; }
.sipip-empty { font-size: 13px; padding: 6px 0; }
.ta-r { text-align: right; }
.sipip-modal-p { font-size: 14px; line-height: 1.5; margin: 0 0 14px; }
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
.reg-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 7px; vertical-align: middle; background: var(--ink-mute); }
.reg-on { background: #35c07f; box-shadow: 0 0 0 3px rgba(53,192,127,0.15); }
.reg-off { background: #d9534f; box-shadow: 0 0 0 3px rgba(217,83,79,0.12); }
.reg-na { background: #6b7280; }
.reg-unknown { background: #c9a94a; }
.reg-label { font-size: 13px; vertical-align: middle; }
.reg-rtt { font-size: 11px; color: var(--ink-soft); margin-left: 6px; vertical-align: middle; }
</style>
