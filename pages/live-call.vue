<template>
  <div>
    <div class="page-head lc-head">
      <div>
        <h1 class="page-title">Live Call</h1>
        <p class="page-sub">A call button for your website and apps — visitors enter their details, then connect to an agent or your AI.</p>
      </div>
    </div>

    <FeatureGate feature="live_call" title="Live Call" blurb="Add a Telroi call widget to your website so visitors can call you in one click — every caller captured as a CRM lead.">


      <div class="lc-subnav">
        <button v-for="t in tabs" :key="t.key" class="lc-subtab" :class="{ on: tab === t.key }" @click="tab = t.key">{{ t.label }}</button>
      </div>

      <!-- SETUP + PREVIEW -->
      <div v-show="tab === 'setup'" class="lc-grid">
        <div class="lc-col">
          <div class="card card-pad">
            <h3 class="lc-h">Appearance &amp; routing</h3>
            <FeatureSettings feature="live_call" @saved="reloadPreview" ref="settingsRef" />
          </div>

          <div class="card card-pad lc-embed">
            <h3 class="lc-h">Install on your website</h3>
            <p class="lc-sub">Paste this just before <code>&lt;/body&gt;</code>. It shows a call button and captures each caller as a lead.</p>
            <pre class="lc-code">{{ webSnippet }}</pre>
            <button class="btn btn-ghost btn-sm" @click="copy(webSnippet)">Copy snippet</button>

            <h3 class="lc-h" style="margin-top:22px">Mobile apps (iOS &amp; Android)</h3>
            <p class="lc-sub">Load the same script inside a WebView and preset the signed-in user. The JS bridge exposes <code>window.TelroiLiveCall</code> so native code can hook call events.</p>
            <pre class="lc-code">{{ mobileSnippet }}</pre>
            <button class="btn btn-ghost btn-sm" @click="copy(mobileSnippet)">Copy mobile bridge</button>
            <p class="lc-note muted">When <code>data-user-id</code> is present the widget marks the caller as a logged-in <strong>user</strong>; without it, a landing-page <strong>visitor</strong>. Both are saved with the lead.</p>
          </div>
        </div>

        <!-- Live preview -->
        <div class="lc-col">
          <div class="card card-pad">
            <h3 class="lc-h">Live preview</h3>
            <p class="lc-sub">This is exactly how the widget will appear on your site.</p>
            <div class="lc-preview" :class="prev.bubblePosition">
              <div v-if="prevOpen" class="lc-pv-panel">
                <div class="lc-pv-head">
                  <div class="lc-pv-icon">
                    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13 1 .35 1.94.65 2.84a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.3 1.84.52 2.84.65A2 2 0 0 1 22 16.92z"/></svg>
                  </div>
                  <div class="lc-pv-htext">
                    <div class="lc-pv-title">{{ prev.greeting }}</div>
                    <div class="lc-pv-status"><span class="lc-pv-dot"></span>We're online now</div>
                  </div>
                </div>
                <div class="lc-pv-body">
                  <p class="lc-pv-p">Talk to {{ prev.routeTo === 'ai' ? 'our smart assistant' : 'a real person' }} in seconds — no phone tag, no hold music. Just leave your name and number and we'll ring you straight away.</p>
                  <input class="lc-pv-input" placeholder="Your name" disabled />
                  <input class="lc-pv-input" placeholder="Mobile number" disabled />
                  <button class="lc-pv-btn" :style="{ background: prev.bubbleColor }">
                    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:7px"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13 1 .35 1.94.65 2.84a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.3 1.84.52 2.84.65A2 2 0 0 1 22 16.92z"/></svg>Start call
                  </button>
                  <p class="lc-pv-route muted">Routes to {{ prev.routeTo === 'ai' ? 'your AI agent' : 'a live agent' }}<template v-if="prev.csatEnabled"> · asks for a rating after</template></p>
                </div>
              </div>
              <button class="lc-pv-bubble" :style="{ background: prev.bubbleColor }" @click="prevOpen = !prevOpen">
                <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="#fff" stroke-width="2"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2 4.2 2 2 0 0 1 4 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.6a2 2 0 0 1-.5 2.1L8.1 9.6a16 16 0 0 0 6 6l1.2-1.1a2 2 0 0 1 2.1-.5c.8.3 1.7.6 2.6.7a2 2 0 0 1 1.7 2z"/></svg>
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- VISITOR MAP -->
      <div v-show="tab === 'map'">
        <div class="card card-pad">
          <h3 class="lc-h">Live visitor locations</h3>
          <p class="lc-sub">Where people are calling from. Based on coarse IP location at the time of the call.</p>
          <div class="lc-map" ref="mapEl"></div>
          <div class="lc-loc-list">
            <div v-for="(g, i) in locationGroups" :key="i" class="lc-loc">
              <span class="lc-loc-city">{{ g.label }}</span>
              <span class="lc-loc-count">{{ g.count }} {{ g.count === 1 ? 'caller' : 'callers' }}</span>
            </div>
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
          <h3 class="lc-h">Business hours</h3>
          <p class="lc-sub">Control when the call widget is available to visitors.</p>
          <LiveCallBusinessHours />
        </div>
      </div>

      <!-- LIVE CALLS — human takeover of AI-handled calls -->
      <div v-show="tab === 'live'">
        <div class="card card-pad">
          <h3 class="lc-h">Live AI calls</h3>
          <p class="lc-sub">Calls your AI agent is handling right now. Take over to step in and talk to the caller yourself — the AI steps aside.</p>
          <div v-if="activeCalls.length">
            <div v-for="c in activeCalls" :key="c.id" class="lc-takeover-row">
              <div>
                <div class="lc-takeover-name">{{ c.visitorName || 'Caller' }} <span class="mono lc-takeover-phone">{{ c.visitorPhone }}</span></div>
                <div class="lc-takeover-meta">{{ [c.city, c.country].filter(Boolean).join(', ') || 'Unknown location' }} · handled by {{ c.handledByLabel || 'AI agent' }}</div>
              </div>
              <button class="btn btn-signal btn-sm" :disabled="takingOver === c.id" @click="takeOver(c)">{{ takingOver === c.id ? 'Taking over…' : 'Take over' }}</button>
            </div>
          </div>
          <p v-else class="lc-empty">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12a8 8 0 0 1 16 0"/><rect x="2.5" y="12" width="4" height="6" rx="1.5"/><rect x="17.5" y="12" width="4" height="6" rx="1.5"/></svg>
            <span>No live AI calls right now.</span>
            <small>When your AI agent is on a call, it'll appear here with a button to take over.</small>
          </p>
        </div>
      </div>
    </FeatureGate>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, watch, nextTick } from 'vue';
const api = useApi();
const toast = useToast();

const tabs = [ { key: 'setup', label: 'Setup' }, { key: 'live', label: 'Live calls' }, { key: 'map', label: 'Visitor map' }, { key: 'csat', label: 'CSAT metrics' }, { key: 'hours', label: 'Business hours' } ];
const tab = ref('setup');
const widgetKey = ref('');
const base = ref('');
const prev = reactive<any>({ bubbleColor: '#1a4b72', bubblePosition: 'middle-right', greeting: 'Need help? Call us.', routeTo: 'agent', csatEnabled: true });
const prevOpen = ref(true);
const sessions = ref<any[]>([]);
const activeCalls = ref<any[]>([]);
const takingOver = ref<string | null>(null);
const metrics = ref<any>({ csat: { distribution: [0,0,0,0,0] } });
const mapEl = ref<HTMLElement | null>(null);

const webSnippet = computed(() => `<script src="${base.value}/widget/v1.js"\n  data-telroi-key="${widgetKey.value || 'YOUR_KEY'}"><\/script>`);
const mobileSnippet = computed(() => `<!-- In your iOS/Android WebView -->\n<script src="${base.value}/widget/v1.js"\n  data-telroi-key="${widgetKey.value || 'YOUR_KEY'}"\n  data-user-id="LOGGED_IN_USER_ID"\n  data-user-name="USER_NAME"\n  data-user-phone="USER_PHONE"><\/script>\n<script>\n  // Native bridge: hook call lifecycle from Swift/Kotlin\n  window.TelroiLiveCall = window.TelroiLiveCall || {};\n  window.TelroiLiveCall.onCall = function (info) {\n    // e.g. window.webkit.messageHandlers.telroi.postMessage(info) (iOS)\n    // or AndroidBridge.onCall(JSON.stringify(info)) (Android)\n  };\n<\/script>`);

const locationGroups = computed(() => {
  const m: Record<string, number> = {};
  for (const s of sessions.value) {
    const label = [s.city, s.country].filter(Boolean).join(', ');
    if (label) m[label] = (m[label] || 0) + 1;
  }
  return Object.entries(m).map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
});
function csatPct(n: number) { const d = metrics.value.csat?.distribution || []; const total = d.reduce((a: number, b: number) => a + b, 0); return total ? Math.round((d[n-1] / total) * 100) : 0; }

function copy(t: string) { navigator.clipboard?.writeText(t); toast.ok('Copied'); }
async function reloadPreview() { await loadPreview(); }
async function loadPreview() {
  try { const r = await api.get<any>('/api/feature-settings/live_call'); Object.assign(prev, r.settings || {}); } catch { /* */ }
}
async function load() {
  base.value = window.location.origin;
  try { const k = await api.get<{ widgetKey: string }>('/api/live-call/widget-key'); widgetKey.value = k.widgetKey; } catch { /* */ }
  await loadPreview();
  try { const s = await api.get<{ sessions: any[] }>('/api/live-call/sessions'); sessions.value = s.sessions; } catch { /* */ }
  try { metrics.value = await api.get<any>('/api/live-call/metrics'); } catch { /* */ }
  await loadActive();
}
async function loadActive() {
  try { const r = await api.get<{ calls: any[] }>('/api/voice/active-ai-calls'); activeCalls.value = r.calls || []; } catch { /* */ }
}
async function takeOver(c: any) {
  takingOver.value = c.id;
  try {
    await api.post('/api/voice/takeover', { callid: `lc_${c.id}` });
    await loadActive();
    toast.ok('You are now on the call');
  } catch (e: any) { toast.err(e?.data?.error?.message || 'Could not take over'); }
  finally { takingOver.value = null; }
}

// Lightweight map: load Leaflet from CDN only when the map tab is opened.
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

let pollT: any = null;
watch(tab, (t) => {
  if (t === 'live') { loadActive(); if (!pollT) pollT = setInterval(loadActive, 8000); }
  else if (pollT) { clearInterval(pollT); pollT = null; }
});
onMounted(load);
useHead({ title: 'Live Call — Telroi' });
</script>

<style scoped>
.lc-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; }
.lc-subnav { display: flex; gap: 2px; border-bottom: 1px solid var(--rule); margin-bottom: 18px; }
.lc-subtab { padding: 9px 16px; font-size: 13px; color: var(--ink-soft); border-bottom: 2px solid transparent; margin-bottom: -1px; }
.lc-subtab.on { color: var(--signal); border-bottom-color: var(--signal); font-weight: 500; }
.lc-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; align-items: start; }
@media (max-width: 920px) { .lc-grid { grid-template-columns: 1fr; } }
.lc-col { display: flex; flex-direction: column; gap: 16px; }
.lc-h { font-size: 15px; font-weight: 600; margin-bottom: 4px; }
.lc-sub { font-size: 13px; color: var(--ink-soft); margin-bottom: 12px; line-height: 1.5; }
.lc-code { background: var(--paper-3); border: 1px solid var(--rule); border-radius: 8px; padding: 12px; font-size: 12px; font-family: monospace; white-space: pre-wrap; word-break: break-all; margin-bottom: 10px; }
.lc-note { font-size: 12px; margin-top: 10px; line-height: 1.5; }
.lc-preview { position: relative; height: 380px; background: var(--paper-2); border: 1px dashed var(--rule-2); border-radius: 12px; overflow: hidden; }
/* Bubble + panel default to bottom-right; modifiers reposition for each option. */
.lc-pv-bubble { position: absolute; bottom: 18px; right: 18px; width: 56px; height: 56px; border-radius: 50%; border: none; cursor: pointer; box-shadow: 0 6px 20px rgba(0,0,0,.18); display: flex; align-items: center; justify-content: center; }
.lc-pv-panel { position: absolute; bottom: 84px; right: 18px; width: 264px; background: #fff; border-radius: 16px; box-shadow: 0 16px 44px rgba(10,10,11,.20); overflow: hidden; }
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
/* Bottom-left */
.lc-preview.bottom-left .lc-pv-bubble, .lc-preview.bottom-left .lc-pv-panel { left: 18px; right: auto; }
/* Middle-right: edge tab centered on the right edge, panel beside it */
.lc-preview.middle-right .lc-pv-bubble { bottom: auto; top: 50%; right: 0; transform: translateY(-50%); width: 46px; height: auto; padding: 12px 10px; border-radius: 12px 0 0 12px; }
.lc-preview.middle-right .lc-pv-panel { bottom: auto; top: 50%; right: 60px; transform: translateY(-50%); }
/* Middle-left: edge tab centered on the left edge, panel beside it */
.lc-preview.middle-left .lc-pv-bubble { bottom: auto; top: 50%; left: 0; right: auto; transform: translateY(-50%); width: 46px; height: auto; padding: 12px 10px; border-radius: 0 12px 12px 0; }
.lc-preview.middle-left .lc-pv-panel { bottom: auto; top: 50%; left: 60px; right: auto; transform: translateY(-50%); }
.lc-map { height: 380px; border-radius: 10px; overflow: hidden; border: 1px solid var(--rule); margin-bottom: 14px; background: var(--paper-2); }
.lc-loc { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid var(--rule-2); font-size: 13.5px; }
.lc-loc-count { color: var(--ink-soft); }
.lc-metrics { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin-bottom: 16px; }
@media (max-width: 760px) { .lc-metrics { grid-template-columns: 1fr 1fr; } }
.lc-metric-v { font-size: 26px; font-weight: 700; }
.lc-metric-l { font-size: 12px; color: var(--ink-soft); margin-top: 4px; }
.lc-csat-row { display: flex; align-items: center; gap: 12px; padding: 6px 0; }
.lc-csat-star { width: 32px; font-size: 13px; color: var(--ink-soft); }
.lc-csat-bar { flex: 1; height: 8px; background: var(--paper-3); border-radius: 999px; overflow: hidden; }
.lc-csat-fill { height: 100%; background: var(--signal); border-radius: 999px; }
.lc-csat-n { width: 28px; text-align: right; font-size: 12.5px; color: var(--ink-soft); }
.lc-takeover-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 0; border-bottom: 1px solid var(--rule-2); }
.lc-takeover-row:first-of-type { border-top: 1px solid var(--rule-2); }
.lc-takeover-row:last-child { border-bottom: none; }
.lc-takeover-name { font-size: 14px; font-weight: 500; color: var(--ink); }
.lc-takeover-phone { font-size: 12.5px; color: var(--ink-soft); margin-left: 8px; font-weight: 400; }
.lc-takeover-meta { font-size: 12px; color: var(--ink-mute); margin-top: 3px; }
.lc-empty { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 6px; padding: 28px 16px; color: var(--ink-mute); }
.lc-empty svg { color: var(--ink-mute); opacity: 0.6; margin-bottom: 2px; }
.lc-empty span { font-size: 13.5px; font-weight: 500; color: var(--ink-soft); }
.lc-empty small { font-size: 12px; color: var(--ink-mute); max-width: 320px; line-height: 1.5; }

</style>
