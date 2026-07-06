<template>
  <div>
    <h1 class="ad-title">Live Call — support console</h1>
    <p class="ad-sub">Telroi’s own Live Call workspace. Customers reach you via the widget in the app; your team manages and answers here. Configure the widget, see where callers are, track satisfaction, and set business hours.</p>

    <div class="lc-subnav">
      <button v-for="t in tabs" :key="t.key" class="lc-subtab" :class="{ on: tab === t.key }" @click="tab = t.key">{{ t.label }}</button>
    </div>

    <!-- SETUP -->
    <div v-show="tab === 'setup'" class="lc-grid">
      <div class="lc-col">
        <div class="card card-pad">
          <h3 class="lc-h">Appearance &amp; routing</h3>
          <p class="lc-sub2">Route support calls to a staff team or your AI agent. Changes save automatically.</p>
          <FeatureSettings feature="live_call"
            endpoint="/api/admin/support/feature-settings/live_call"
            routing-endpoint="/api/admin/support/routing-options"
            @saved="loadPreview" />
        </div>
        <div class="card card-pad">
          <h3 class="lc-h">Add the support widget to other pages</h3>
          <p class="lc-sub2">It already appears for signed-in customers in the app. To add it to your marketing site or any other page, paste this snippet before <code>&lt;/body&gt;</code>.</p>
          <pre class="lc-code">{{ webSnippet }}</pre>
          <button class="btn btn-ghost btn-sm" @click="copy(webSnippet)">Copy snippet</button>
          <h3 class="lc-h" style="margin-top:20px">Mobile apps</h3>
          <p class="lc-sub2">Load the same script in a WebView and preset the signed-in user; native code hooks <code>window.TelroiLiveCall</code>.</p>
          <pre class="lc-code">{{ mobileSnippet }}</pre>
          <button class="btn btn-ghost btn-sm" @click="copy(mobileSnippet)">Copy mobile bridge</button>
        </div>
      </div>
      <div class="lc-col">
        <div class="card card-pad">
          <h3 class="lc-h">Live preview</h3>
          <p class="lc-sub2">How the support widget appears to customers.</p>
          <div class="lc-preview" :class="prev.bubblePosition">
            <div v-if="prevOpen" class="lc-pv-panel">
              <div class="lc-pv-head2">
                <div class="lc-pv-status"><span class="lc-pv-dot"></span>We're online now</div>
                <span class="lc-pv-x">×</span>
              </div>
              <div class="lc-pv-body">
                <div class="lc-pv-hero">
                  <div class="lc-pv-orb" :style="{ '--oc': prev.bubbleColor }">
                    <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13 1 .35 1.94.65 2.84a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.3 1.84.52 2.84.65A2 2 0 0 1 22 16.92z"/></svg>
                  </div>
                  <div class="lc-pv-h2">{{ prev.greeting }}</div>
                  <div class="lc-pv-hsub">Enter your details — we'll ring you back in seconds.</div>
                </div>
                <div class="lc-pv-row">
                  <input class="lc-pv-pill" placeholder="Name" disabled />
                  <input class="lc-pv-pill" placeholder="Number" disabled />
                </div>
                <button class="lc-pv-btn2" :style="{ background: prev.bubbleColor }">Request call
                  <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="margin-left:8px;vertical-align:-3px"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
                </button>
                <p class="lc-pv-route muted">Routes to {{ prev.routeTo === 'ai' ? 'your AI agent' : 'the support team' }}<template v-if="prev.csatEnabled"> · rating after</template></p>
              </div>
            </div>
            <button class="lc-pv-bubble" :style="{ background: prev.bubbleColor }" @click="prevOpen = !prevOpen">
              <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="#fff" stroke-width="2"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2 4.2 2 2 0 0 1 4 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.6a2 2 0 0 1-.5 2.1L8.1 9.6a16 16 0 0 0 6 6l1.2-1.1a2 2 0 0 1 2.1-.5c.8.3 1.7.6 2.6.7a2 2 0 0 1 1.7 2z"/></svg>
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- SESSIONS (management) -->
    <div v-show="tab === 'sessions'" class="card card-pad lc-pad0">
      <table class="ad-table">
        <thead><tr><th>Caller</th><th>Phone</th><th>Type</th><th>Location</th><th>Handled by</th><th>Outcome</th><th>CSAT</th><th>When</th></tr></thead>
        <tbody>
          <tr v-for="s in sessions" :key="s.id">
            <td>{{ s.visitorName || '—' }}</td>
            <td class="mono">{{ s.visitorPhone || '—' }}</td>
            <td><span class="lc-pip">{{ s.visitorType === 'user' ? 'User' : 'Visitor' }}</span></td>
            <td>{{ [s.city, s.country].filter(Boolean).join(', ') || '—' }}</td>
            <td>{{ s.handledByLabel || '—' }}</td>
            <td><span class="lc-out" :class="s.outcome || s.status">{{ s.outcome || s.status }}</span></td>
            <td>{{ s.csatScore ? s.csatScore + '★' : '—' }}</td>
            <td class="ad-dim">{{ fmt(s.startedAt) }}</td>
          </tr>
          <tr v-if="!sessions.length"><td colspan="8" class="lc-empty2">No support calls yet.</td></tr>
        </tbody>
      </table>
    </div>

    <!-- VISITOR MAP -->
    <div v-show="tab === 'map'">
      <div class="card card-pad">
        <h3 class="lc-h">Where customers are calling from</h3>
        <p class="lc-sub2">Coarse IP location at the time of the call.</p>
        <div class="lc-map" ref="mapEl"></div>
        <div class="lc-loc-list">
          <div v-for="(g, i) in locationGroups" :key="i" class="lc-loc"><span>{{ g.label }}</span><span class="muted">{{ g.count }} {{ g.count === 1 ? 'caller' : 'callers' }}</span></div>
          <p v-if="!locationGroups.length" class="muted">No located sessions yet.</p>
        </div>
      </div>
    </div>

    <!-- CSAT METRICS -->
    <div v-show="tab === 'csat'">
      <LiveCallMetrics :metrics="metrics" />
    </div>

    <!-- BUSINESS HOURS -->
    <div v-show="tab === 'hours'">
      <div class="card card-pad">
        <h3 class="lc-h">Support business hours</h3>
        <p class="lc-sub2">When the support widget is available to customers.</p>
        <LiveCallBusinessHours endpoint="/api/admin/support/feature-settings/live_call" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, watch, nextTick } from 'vue';
definePageMeta({ layout: 'admin' });
const toast = useToast();

const tabs = [
  { key: 'setup', label: 'Setup' },
  { key: 'sessions', label: 'Call sessions' },
  { key: 'map', label: 'Visitor map' },
  { key: 'csat', label: 'CSAT metrics' },
  { key: 'hours', label: 'Business hours' }
];
const tab = ref('setup');
const prev = reactive<any>({ bubbleColor: '#1a4b72', bubblePosition: 'middle-right', greeting: 'Need help? Call us.', routeTo: 'agent', csatEnabled: true });
const prevOpen = ref(true);
const sessions = ref<any[]>([]);
const metrics = ref<any>({});
const widgetKey = ref('');
const base = ref('');
const mapEl = ref<HTMLElement | null>(null);

const webSnippet = computed(() => `<script src="${base.value}/widget/v1.js"\n  data-telroi-key="${widgetKey.value || 'SUPPORT_KEY'}"><\/script>`);
const mobileSnippet = computed(() => `<script src="${base.value}/widget/v1.js"\n  data-telroi-key="${widgetKey.value || 'SUPPORT_KEY'}"\n  data-user-id="USER_ID" data-user-name="NAME" data-user-phone="PHONE"><\/script>`);

const locationGroups = computed(() => {
  const m: Record<string, number> = {};
  for (const s of sessions.value) { const l = [s.city, s.country].filter(Boolean).join(', '); if (l) m[l] = (m[l] || 0) + 1; }
  return Object.entries(m).map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
});

function fmt(d: string) { return d ? new Date(d).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'; }
function copy(t: string) { navigator.clipboard?.writeText(t); toast.ok('Copied'); }

async function loadPreview() {
  try { const r = await $fetch<any>('/api/admin/support/feature-settings/live_call'); Object.assign(prev, r.settings || {}); } catch { /* */ }
}
async function load() {
  base.value = window.location.origin;
  try { const w = await $fetch<any>('/api/admin/support/widget'); widgetKey.value = w.key; Object.assign(prev, w.config || {}); } catch { /* */ }
  try { const r = await $fetch<any>('/api/admin/support/sessions'); sessions.value = r.sessions || []; } catch { /* */ }
  try { metrics.value = await $fetch<any>('/api/admin/support/metrics'); } catch { /* */ }
}

let mapInited = false;
watch(tab, async (t) => { if (t === 'map' && !mapInited) { await nextTick(); initMap(); } });
function initMap() {
  mapInited = true;
  const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'; document.head.appendChild(link);
  const sc = document.createElement('script'); sc.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
  sc.onload = () => {
    const L = (window as any).L; if (!L || !mapEl.value) return;
    const map = L.map(mapEl.value).setView([20, 0], 2);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(map);
    sessions.value.forEach((s) => { if (s.lat && s.lng) L.marker([parseFloat(s.lat), parseFloat(s.lng)]).addTo(map).bindPopup((s.visitorName || 'Visitor') + '<br>' + [s.city, s.country].filter(Boolean).join(', ')); });
  };
  document.body.appendChild(sc);
}

onMounted(load);
useHead({ title: 'Live Call — Telroi Admin' });
</script>

<style scoped>
.lc-subnav { display: flex; gap: 2px; border-bottom: 1px solid var(--rule); margin-bottom: 18px; }
/* Sessions table — match the core admin table styling so columns align. */
.ad-table { width: 100%; border-collapse: collapse; }
.ad-table th { text-align: left; font-family: var(--font-mono); font-size: 10.5px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink-mute); font-weight: 500; padding: 14px 16px; border-bottom: 1px solid var(--rule); white-space: nowrap; }
.ad-table td { padding: 14px 16px; border-bottom: 1px solid var(--rule-2); color: var(--ink); font-size: 14px; vertical-align: middle; }
.ad-table tbody tr:last-child td { border-bottom: none; }
.ad-table tbody tr:hover { background: var(--paper-2); }
.ad-dim { color: var(--ink-mute); font-size: 12.5px; white-space: nowrap; }
.mono { font-family: var(--font-mono); font-size: 13px; }
.lc-subtab { padding: 9px 16px; font-size: 13px; color: var(--ink-soft); border-bottom: 2px solid transparent; margin-bottom: -1px; background: none; }
.lc-subtab.on { color: var(--signal); border-bottom-color: var(--signal); font-weight: 500; }
.lc-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; align-items: start; }
@media (max-width: 920px) { .lc-grid { grid-template-columns: 1fr; } }
.lc-col { display: flex; flex-direction: column; gap: 16px; }
.lc-h { font-size: 15px; font-weight: 600; margin-bottom: 4px; }
.lc-sub2 { font-size: 12.5px; color: var(--ink-soft); margin-bottom: 12px; line-height: 1.5; }
.lc-code { background: var(--paper-3); border: 1px solid var(--rule); border-radius: 8px; padding: 12px; font-size: 12px; font-family: monospace; white-space: pre-wrap; word-break: break-all; margin-bottom: 10px; }
.lc-pad0 { padding: 0 !important; overflow: hidden; }
.lc-pip { font-size: 11px; padding: 2px 8px; border-radius: 999px; background: var(--paper-3); color: var(--ink-soft); }
.lc-out { font-size: 11px; padding: 2px 8px; border-radius: 999px; text-transform: capitalize; background: var(--paper-3); color: var(--ink-soft); }
.lc-out.answered, .lc-out.ended, .lc-out.connected { background: #e7f4ee; color: #1a7a4f; }
.lc-out.failed, .lc-out.missed, .lc-out.abandoned { background: #fbeae7; color: #c0392b; }
.lc-empty2 { text-align: center; color: var(--ink-mute); padding: 26px; }
.lc-preview { position: relative; height: 380px; background: var(--paper-2); border: 1px dashed var(--rule-2); border-radius: 12px; overflow: hidden; }
.lc-pv-head2 { display: flex; align-items: center; justify-content: space-between; padding: 16px 18px 4px; }
.lc-pv-x { color: #b5b1a8; font-size: 17px; }
.lc-pv-hero { text-align: center; padding: 4px 0 2px; }
.lc-pv-orb { position: relative; width: 92px; height: 92px; margin: 0 auto 14px; border-radius: 50%; background: color-mix(in srgb, var(--oc) 10%, transparent); display: flex; align-items: center; justify-content: center; }
.lc-pv-orb::before { content: ''; position: absolute; inset: 11px; border-radius: 50%; background: color-mix(in srgb, var(--oc) 16%, transparent); }
.lc-pv-orb svg { position: relative; z-index: 1; width: 44px; height: 44px; padding: 9px; border-radius: 50%; background: var(--oc); box-sizing: border-box; }
.lc-pv-h2 { font-size: 17px; font-weight: 600; color: #1a1a1a; }
.lc-pv-hsub { font-size: 12.5px; color: #8a877f; margin: 4px 0 16px; line-height: 1.5; }
.lc-pv-row { display: flex; gap: 8px; margin-bottom: 11px; }
.lc-pv-pill { flex: 1; min-width: 0; box-sizing: border-box; padding: 11px 12px; border: 1px solid #eceae4; border-radius: 12px; font-size: 13px; background: #f5f4f0; color: #a8a49c; }
.lc-pv-btn2 { width: 100%; padding: 14px; border: none; border-radius: 999px; color: #fff; font-size: 14.5px; font-weight: 600; display: flex; align-items: center; justify-content: center; cursor: default; }
.lc-pv-bubble { position: absolute; bottom: 18px; right: 18px; width: 56px; height: 56px; border-radius: 50%; border: none; cursor: pointer; box-shadow: 0 6px 20px rgba(0,0,0,.18); display: flex; align-items: center; justify-content: center; }
.lc-pv-panel { position: absolute; bottom: 84px; right: 18px; width: 264px; background: #fff; border-radius: 16px; box-shadow: 0 16px 44px rgba(10,10,11,.20); overflow: hidden; }
.lc-preview.bottom-left .lc-pv-bubble, .lc-preview.bottom-left .lc-pv-panel { left: 18px; right: auto; }
.lc-preview.middle-right .lc-pv-bubble { bottom: auto; top: 50%; right: 0; transform: translateY(-50%); width: 46px; height: auto; padding: 12px 10px; border-radius: 12px 0 0 12px; }
.lc-preview.middle-right .lc-pv-panel { bottom: auto; top: 50%; right: 60px; transform: translateY(-50%); }
.lc-preview.middle-left .lc-pv-bubble { bottom: auto; top: 50%; left: 0; right: auto; transform: translateY(-50%); width: 46px; height: auto; padding: 12px 10px; border-radius: 0 12px 12px 0; }
.lc-preview.middle-left .lc-pv-panel { bottom: auto; top: 50%; left: 60px; right: auto; transform: translateY(-50%); }
.lc-pv-head { display: flex; align-items: center; gap: 10px; padding: 16px 16px 14px; background: #f7f6f3; border-bottom: 1px solid #ececec; }
.lc-pv-icon { flex: none; width: 38px; height: 38px; border-radius: 50%; background: #fff; color: #9a9690; display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 6px rgba(10,10,11,.08); border: 1px solid #ececec; }
.lc-pv-htext { flex: 1; min-width: 0; }
.lc-pv-title { font-size: 14px; font-weight: 650; color: var(--ink); letter-spacing: -.01em; line-height: 1.2; }
.lc-pv-status { display: flex; align-items: center; gap: 6px; margin-top: 2px; font-size: 11.5px; color: #8a8780; }
.lc-pv-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--live, #00d28a); box-shadow: 0 0 0 3px rgba(0,210,138,.16); }
.lc-pv-body { padding: 16px; }
.lc-pv-p { font-size: 12.5px; color: #6b6862; margin: 0 0 12px; line-height: 1.5; }
.lc-pv-input { width: 100%; box-sizing: border-box; padding: 10px 12px; margin-bottom: 9px; border: 1px solid #e4e1da; border-radius: 10px; font-size: 13px; background: #faf9f6; }
.lc-pv-btn { width: 100%; padding: 11px; border: none; border-radius: 10px; color: #fff; font-size: 13px; font-weight: 600; display: flex; align-items: center; justify-content: center; box-shadow: 0 5px 14px rgba(26,75,114,.26); }
.lc-pv-route { font-size: 11px; margin-top: 10px; text-align: center; }
.lc-map { height: 380px; border-radius: 10px; overflow: hidden; border: 1px solid var(--rule); margin-bottom: 14px; background: var(--paper-2); }
.lc-loc { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid var(--rule-2); font-size: 13.5px; }
</style>
