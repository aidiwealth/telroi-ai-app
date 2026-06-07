<template>
  <div>
    <div class="page-head">
      <div>
        <h1 class="page-title">Apps &amp; integrations</h1>
        <p class="page-sub">Get Telroi on every device, and connect the tools your team already uses.</p>
      </div>
    </div>

    <FeatureGate feature="apps" title="Apps &amp; Integrations" blurb="Get the Telroi desktop and mobile apps, and connect the tools your team already uses. Available on the Growth plan, alongside the full Telroi One suite.">
    <!-- Sub-menu -->
    <div class="ai-subnav">
      <button v-if="fsettings.showApps" class="ai-subtab" :class="{ on: tab === 'apps' }" @click="tab = 'apps'">Apps</button>
      <button v-if="fsettings.showIntegrations" class="ai-subtab" :class="{ on: tab === 'integrations' }" @click="tab = 'integrations'">Integrations</button>
      <button class="ai-settings-btn" @click="showSettings = true" title="Settings">
        <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="8" cy="8" r="2.2"/><path d="M8 1.5v2M8 12.5v2M14.5 8h-2M3.5 8h-2M12.6 3.4l-1.4 1.4M4.8 11.2l-1.4 1.4M12.6 12.6l-1.4-1.4M4.8 4.8L3.4 3.4"/></svg>
      </button>
    </div>

    <!-- Toolbar -->
    <div class="ai-toolbar">
      <input v-model="q" class="input ai-search" :placeholder="tab === 'apps' ? 'Search apps…' : 'Search integrations…'" />
      <div v-if="tab === 'apps'" class="ai-filters">
        <button v-for="f in platformFilters" :key="f" class="ai-chip" :class="{ on: platformFilter === f }" @click="platformFilter = f">{{ f }}</button>
      </div>
      <div v-else class="ai-filters">
        <button v-for="f in categoryFilters" :key="f" class="ai-chip" :class="{ on: categoryFilter === f }" @click="categoryFilter = f">{{ f }}</button>
      </div>
    </div>

    <!-- Apps grid -->
    <div v-if="tab === 'apps'" class="ai-grid">
      <div v-for="a in filteredApps" :key="a.platform" class="ai-card">
        <div class="ai-card-icon" :style="{ background: a.accent }" v-html="iconFor(a.iconKey)" />
        <div class="ai-card-body">
          <div class="ai-card-title">{{ a.name }}<span v-if="a.status === 'coming_soon'" class="ai-soon">Coming soon</span></div>
          <div class="ai-card-desc">{{ a.description }}</div>
          <div class="ai-card-meta">{{ [a.requirement, a.fileSize, a.version ? 'v' + a.version : null].filter(Boolean).join(' · ') }}</div>
        </div>
        <div class="ai-card-actions">
          <a v-if="a.status === 'available' && a.downloadUrl" :href="a.downloadUrl" target="_blank" rel="noopener" class="btn btn-signal btn-sm ai-dl">
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M8 2v8M4.5 7L8 10.5 11.5 7M3 13h10"/></svg>
            Download
          </a>
          <button v-else class="btn btn-ghost btn-sm" disabled>{{ a.status === 'coming_soon' ? 'Coming soon' : 'Unavailable' }}</button>
        </div>
      </div>
      <p v-if="!filteredApps.length" class="ai-empty muted">No apps match your search.</p>
    </div>

    <!-- Integrations grid -->
    <div v-else class="ai-grid">
      <div v-for="i in filteredIntegrations" :key="i.key" class="ai-card">
        <div class="ai-card-logo"><img :src="i.logo" :alt="i.name" loading="lazy" /></div>
        <div class="ai-card-body">
          <div class="ai-card-title">{{ i.name }}<span v-if="conn[i.key]?.status === 'connected'" class="ai-connected">Connected</span><span v-else-if="conn[i.key]?.status === 'error'" class="ai-errored">Needs attention</span></div>
          <div class="ai-card-desc">{{ i.desc }}</div>
          <div class="ai-card-meta">
            {{ i.category }}
            <template v-if="conn[i.key]?.status === 'connected'">
              · <span v-if="conn[i.key]?.modeEmbed">In-CRM</span><span v-if="conn[i.key]?.modeEmbed && conn[i.key]?.modeImport"> + </span><span v-if="conn[i.key]?.modeImport">Import</span>
            </template>
          </div>
        </div>
        <div class="ai-card-actions">
          <template v-if="conn[i.key]?.status === 'connected'">
            <button class="btn btn-ghost btn-sm" @click="openConfigure(i)">Configure</button>
            <button class="btn btn-ghost btn-sm" @click="disconnect(i)">Disconnect</button>
          </template>
          <button v-else class="btn btn-signal btn-sm" @click="openConnect(i)">Connect</button>
        </div>
      </div>
      <p v-if="!filteredIntegrations.length" class="ai-empty muted">No integrations match your search.</p>
    </div>
    </FeatureGate>

    <!-- Connect modal -->
    <div v-if="connectTarget" class="ai-modal-overlay" @click.self="connectTarget = null">
      <div class="modal card ai-connect-modal">
        <div class="card-head"><span class="card-title">Connect {{ connectTarget.name }}</span><button class="ai-x" @click="connectTarget = null">✕</button></div>
        <div class="card-pad">
          <p class="muted ai-modal-lede">{{ connectTarget.blurb }}</p>

          <!-- Direction choice (only where the provider supports it) -->
          <div v-if="connectTarget.supports.embed || connectTarget.supports.import" class="ai-modes">
            <label v-if="connectTarget.supports.embed" class="ai-mode" :class="{ on: cForm.modeEmbed }">
              <input type="checkbox" v-model="cForm.modeEmbed" />
              <span><strong>Use Telroi inside {{ connectTarget.name }}</strong><small>Click-to-call, screen-pop on inbound, and calls logged onto the right record.</small></span>
            </label>
            <label v-if="connectTarget.supports.import" class="ai-mode" :class="{ on: cForm.modeImport }">
              <input type="checkbox" v-model="cForm.modeImport" />
              <span><strong>Import data into Telroi</strong><small>Pull your {{ connectTarget.name }} contacts into Telroi and sync call activity back.</small></span>
            </label>
          </div>

          <!-- One-click OAuth where configured; manual token paste otherwise. -->
          <div v-if="oauthOk(connectTarget.key)" class="ai-oauth">
            <button class="btn btn-signal btn-block" :disabled="connecting" @click="connectOAuth(connectTarget)">{{ connecting ? 'Redirecting…' : `Connect with ${connectTarget.name}` }}</button>
            <p class="muted" style="font-size:12px;text-align:center;margin:8px 0 0">You'll be sent to {{ connectTarget.name }} to authorize, then back here.</p>
            <button class="ai-manual-toggle" @click="manualMode = !manualMode">{{ manualMode ? 'Hide manual setup' : 'Or paste a token manually' }}</button>
          </div>

          <!-- Provider-specific credential fields (manual path) -->
          <template v-if="!oauthOk(connectTarget.key) || manualMode">
            <div v-for="f in (connectTarget.fields || [])" :key="f.k" class="field">
              <label>{{ f.label }}</label>
              <input v-model="cForm.creds[f.k]" class="input mono" :placeholder="f.placeholder" />
              <span v-if="f.hint" class="muted" style="font-size:12px">{{ f.hint }}</span>
            </div>
            <p v-if="connectTarget.key === 'zapier'" class="muted" style="font-size:12.5px;margin:-4px 0 12px">After connecting, add the Zapier hook URLs you want Telroi to trigger under Configure.</p>
            <button class="btn btn-signal btn-block" :disabled="connecting || !canConnect" @click="doConnect">{{ connecting ? 'Connecting…' : 'Connect' }}</button>
          </template>
        </div>
      </div>
    </div>

    <!-- Configure modal (post-connect: import, events, embed bridge) -->
    <div v-if="configureTarget" class="ai-modal-overlay" @click.self="configureTarget = null">
      <div class="modal card ai-configure-modal">
        <div class="card-head"><span class="card-title">{{ configureTarget.name }} · Configure</span><button class="ai-x" @click="configureTarget = null">✕</button></div>
        <div class="card-pad">
          <!-- Import direction -->
          <section v-if="configureTarget.supports.import" class="ai-cfg-sec">
            <h4 class="ai-cfg-h">Import contacts</h4>
            <p class="muted ai-cfg-p">Pull your {{ configureTarget.name }} contacts into Telroi's CRM. Calls you make are logged back automatically.
              <template v-if="conn[configureTarget.key]?.lastImportAt"><br>Last import: {{ fmtWhen(conn[configureTarget.key].lastImportAt) }} · {{ conn[configureTarget.key].importedCount || 0 }} contacts.</template>
            </p>
            <button class="btn btn-ghost btn-sm" :disabled="importing" @click="runImport(configureTarget)">{{ importing ? 'Importing…' : 'Import now' }}</button>
            <p v-if="conn[configureTarget.key]?.lastSyncError" class="ai-cfg-err">Last error: {{ conn[configureTarget.key].lastSyncError }}</p>
          </section>

          <!-- Embed direction -->
          <section v-if="configureTarget.supports.embed" class="ai-cfg-sec">
            <h4 class="ai-cfg-h">Use Telroi inside {{ configureTarget.name }}</h4>
            <p class="muted ai-cfg-p">Add the Telroi calling panel to {{ configureTarget.name }} so your team can click-to-call and see who's calling, with calls logged automatically. Use this connection key when installing the Telroi app from the {{ configureTarget.name }} marketplace:</p>
            <div class="ai-key-row"><input class="input mono" :value="bridgeKey || '—'" readonly /><button class="btn btn-ghost btn-sm" @click="copy(bridgeKey)">Copy</button></div>
            <p class="muted" style="font-size:11.5px;margin-top:6px">Install the Telroi app inside {{ configureTarget.name }} and paste this key to link your workspace.</p>
          </section>

          <!-- Event subscriptions (Zapier + any) -->
          <section v-if="configureTarget.supports.events" class="ai-cfg-sec">
            <h4 class="ai-cfg-h">Event triggers</h4>
            <p class="muted ai-cfg-p">Send Telroi events to {{ configureTarget.key === 'zapier' ? 'Zapier' : configureTarget.name }}. Paste a hook URL and pick the event that should trigger it.</p>
            <div class="ai-evt-add">
              <select v-model="evtForm.event" class="select">
                <option value="call.completed">Call completed</option>
                <option value="call.missed">Call missed</option>
                <option value="voicemail.received">Voicemail received</option>
                <option value="contact.created">Contact created</option>
              </select>
              <input v-model="evtForm.targetUrl" class="input mono" placeholder="https://hooks.zapier.com/…" />
              <button class="btn btn-signal btn-sm" :disabled="addingEvt || !evtForm.targetUrl" @click="addEvent(configureTarget)">Add</button>
            </div>
            <div v-if="providerEvents(configureTarget.key).length" class="ai-evt-list">
              <div v-for="e in providerEvents(configureTarget.key)" :key="e.id" class="ai-evt-row">
                <span class="ai-evt-name">{{ eventLabel(e.event) }}</span>
                <span class="ai-evt-url mono">{{ shortUrl(e.targetUrl) }}</span>
                <button class="ai-evt-del" @click="removeEvent(e.id)" title="Remove">✕</button>
              </div>
            </div>
          </section>

          <button class="btn btn-signal btn-block" @click="configureTarget = null">Done</button>
        </div>
      </div>
    </div>

    <!-- App settings modal -->

    <!-- Feature settings modal -->
    <div v-if="showSettings" class="ai-modal-overlay" @click.self="showSettings = false">
      <div class="modal card ai-settings-modal">
        <div class="card-head"><span class="card-title">Apps &amp; integrations settings</span><button class="ai-x" @click="showSettings = false">✕</button></div>
        <div class="card-pad"><FeatureSettings feature="apps" @vue:unmounted="load" /></div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue';
const api = useApi();
const toast = useToast();

const tab = ref<'apps' | 'integrations'>('apps');
const q = ref('');
const platformFilter = ref('All');
const categoryFilter = ref('All');
const platformFilters = ['All', 'Mobile', 'Desktop'];
const categoryFilters = ['All', 'Automation', 'CRM'];

const apps = ref<any[]>([]);
function iconFor(key: string) {
  switch (key) {
    case 'android': return androidSvg();
    case 'windows': return windowsSvg();
    case 'linux': return linuxSvg();
    case 'browser': return browserSvg();
    default: return appleSvg();
  }
}
const CDN = 'https://pub-f138f42d66b748108ebf7432c7314665.r2.dev';
const integrations = [
  { key: 'zapier', name: 'Zapier', desc: 'Automate workflows — trigger Zaps when calls complete, send call data anywhere.', category: 'Automation', logo: `${CDN}/zapier.svg`,
    supports: { embed: false, import: false, events: true },
    blurb: 'Connect Zapier to trigger Zaps from Telroi events (calls, voicemails, new contacts).' },
  { key: 'pipedrive', name: 'Pipedrive', desc: 'Use Telroi inside Pipedrive, or import your people and log every call as an activity.', category: 'CRM', logo: `${CDN}/pipedrive.png`,
    supports: { embed: true, import: true, events: true },
    blurb: 'Connect Pipedrive to use Telroi inside it (click-to-call, screen-pop) and/or import contacts and log calls.',
    fields: [ { k: 'apiKey', label: 'API token', placeholder: 'Pipedrive API token', required: true }, { k: 'domain', label: 'Company domain (optional)', placeholder: 'yourcompany' } ] },
  { key: 'hubspot', name: 'HubSpot', desc: 'Use Telroi inside HubSpot, or import contacts with two-way call logging.', category: 'CRM', logo: `${CDN}/hubspot.svg`,
    supports: { embed: true, import: true, events: true },
    blurb: 'Connect HubSpot to use Telroi inside it (calling panel, screen-pop) and/or import contacts and log calls onto records.',
    fields: [ { k: 'apiKey', label: 'Private app token', placeholder: 'pat-…', required: true } ] },
  { key: 'zoho', name: 'Zoho CRM', desc: 'Use Telroi inside Zoho, or import contacts and log calls to the right record.', category: 'CRM', logo: `${CDN}/zoho.png`,
    supports: { embed: true, import: true, events: true },
    blurb: 'Connect Zoho CRM to use Telroi inside it (PhoneBridge-style calling) and/or import contacts and log calls.',
    fields: [ { k: 'accessToken', label: 'OAuth access token', placeholder: 'Zoho-oauthtoken …', required: true }, { k: 'dc', label: 'Data center', placeholder: 'com', hint: 'com, eu, in, com.au, jp …' } ] }
];

const conn = ref<Record<string, any>>({});
const bridgeKey = ref<string | null>(null);
const events = ref<any[]>([]);
const oauthStatus = ref<Record<string, boolean>>({});
const manualMode = ref(false);
function oauthOk(key: string) { return !!oauthStatus.value[key]; }
async function connectOAuth(t: any) {
  connecting.value = true;
  try {
    const dc = t.key === 'zoho' ? (cForm.creds.dc || 'com') : undefined;
    const r = await api.get<{ url: string }>(`/api/integrations/oauth/start?provider=${t.key}${dc ? `&dc=${dc}` : ''}`);
    window.location.href = r.url; // hand off to the provider
  } catch (e: any) { toast.err(e?.data?.error?.message || 'Could not start connect'); connecting.value = false; }
}
const fsettings = ref<Record<string, any>>({ showApps: true, showIntegrations: true, allowedIntegrations: ['zapier','pipedrive','hubspot','zoho'] });
const showSettings = ref(false);
const connectTarget = ref<any>(null);
const configureTarget = ref<any>(null);
const connecting = ref(false);
const importing = ref(false);
const addingEvt = ref(false);

const cForm = reactive<{ modeEmbed: boolean; modeImport: boolean; creds: Record<string, string> }>({ modeEmbed: true, modeImport: false, creds: {} });
const evtForm = reactive({ event: 'call.completed', targetUrl: '' });

const canConnect = computed(() => {
  const t = connectTarget.value; if (!t) return false;
  // required credential fields must be filled
  for (const f of (t.fields || [])) if (f.required && !cForm.creds[f.k]) return false;
  // at least one direction selected where applicable
  if ((t.supports.embed || t.supports.import) && !cForm.modeEmbed && !cForm.modeImport) return false;
  return true;
});

const filteredApps = computed(() => apps.value.filter((a) =>
  (platformFilter.value === 'All' || a.groupLabel === platformFilter.value) &&
  (!q.value || ((a.name || '') + (a.description || '')).toLowerCase().includes(q.value.toLowerCase()))
));
const filteredIntegrations = computed(() => {
  // Allowed list from settings. If a saved list predates Zoho (i.e. it lacks
  // zoho but includes the original three), treat Zoho as allowed too — no admin
  // ever explicitly disabled it, it just didn't exist when the list was saved.
  let allowed = fsettings.value.allowedIntegrations || ['zapier','pipedrive','hubspot','zoho'];
  if (!allowed.includes('zoho') && allowed.includes('hubspot')) allowed = [...allowed, 'zoho'];
  return integrations.filter((i) =>
    allowed.includes(i.key) &&
    (categoryFilter.value === 'All' || i.category === categoryFilter.value) &&
    (!q.value || (i.name + i.desc).toLowerCase().includes(q.value.toLowerCase()))
  );
});

function openConnect(i: any) {
  connectTarget.value = i;
  cForm.modeEmbed = !!i.supports.embed;
  cForm.modeImport = false;
  cForm.creds = {};
  manualMode.value = false;
}
async function doConnect() {
  const t = connectTarget.value; if (!t) return;
  connecting.value = true;
  try {
    await api.post('/api/integrations/connect', {
      provider: t.key, ...cForm.creds,
      modeEmbed: t.supports.embed ? cForm.modeEmbed : false,
      modeImport: t.supports.import ? cForm.modeImport : false
    });
    toast.ok(`${t.name} connected`);
    connectTarget.value = null;
    await load();
  } catch (e: any) { toast.err(e?.data?.error?.message || 'Could not connect'); }
  finally { connecting.value = false; }
}
async function disconnect(i: any) {
  if (!confirm(`Disconnect ${i.name}?`)) return;
  try { await api.post('/api/integrations/disconnect', { provider: i.key }); await load(); toast.ok('Disconnected'); }
  catch (e: any) { toast.err(e?.data?.error?.message || 'Could not disconnect'); }
}
function openConfigure(i: any) { configureTarget.value = i; evtForm.targetUrl = ''; evtForm.event = 'call.completed'; }
async function runImport(i: any) {
  importing.value = true;
  try { const r = await api.post<any>('/api/integrations/import', { provider: i.key }); toast.ok(`Imported ${r.imported} contact(s)`); await load(); }
  catch (e: any) { toast.err(e?.data?.error?.message || 'Import failed'); }
  finally { importing.value = false; }
}
async function addEvent(i: any) {
  if (!evtForm.targetUrl) return;
  addingEvt.value = true;
  try { await api.post('/api/integrations/events', { provider: i.key, event: evtForm.event, targetUrl: evtForm.targetUrl }); evtForm.targetUrl = ''; await loadEvents(); toast.ok('Event trigger added'); }
  catch (e: any) { toast.err(e?.data?.error?.message || 'Could not add'); }
  finally { addingEvt.value = false; }
}
async function removeEvent(id: string) {
  try { await api.del(`/api/integrations/events/${id}`); await loadEvents(); }
  catch (e: any) { toast.err(e?.data?.error?.message || 'Could not remove'); }
}
function providerEvents(key: string) { return events.value.filter((e) => e.provider === key); }
function eventLabel(e: string) { return ({ 'call.completed': 'Call completed', 'call.missed': 'Call missed', 'voicemail.received': 'Voicemail received', 'contact.created': 'Contact created' } as any)[e] || e; }
function shortUrl(u: string) { try { const x = new URL(u); return x.host + (x.pathname.length > 16 ? x.pathname.slice(0, 16) + '…' : x.pathname); } catch { return u.slice(0, 28) + '…'; } }
function fmtWhen(s: string) { try { return new Date(s).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch { return s; } }
async function copy(v: string | null) { if (!v) return; try { await navigator.clipboard.writeText(v); toast.ok('Copied'); } catch { /* */ } }

async function loadEvents() { try { events.value = (await api.get<any>('/api/integrations/events')).items || []; } catch { events.value = []; } }
async function load() {
  try { apps.value = (await api.get<{ apps: any[] }>('/api/apps')).apps || []; } catch { apps.value = []; }
  try { const r = await api.get<{ connections: Record<string, any>; bridgeKey: string | null }>('/api/integrations'); conn.value = r.connections; bridgeKey.value = r.bridgeKey; } catch { /* */ }
  try { oauthStatus.value = (await api.get<any>('/api/integrations/oauth/status')).oauth || {}; } catch { /* */ }
  await loadEvents();
  try {
    const fs = await api.get<any>('/api/feature-settings/apps');
    fsettings.value = fs.settings || fsettings.value;
    if (!fsettings.value.showApps && fsettings.value.showIntegrations) tab.value = 'integrations';
    if (!fsettings.value.showIntegrations && fsettings.value.showApps) tab.value = 'apps';
  } catch { /* */ }
  // Returning from an OAuth round-trip?
  const params = new URLSearchParams(window.location.search);
  const connected = params.get('connected');
  if (connected) {
    tab.value = 'integrations';
    if (connected === 'error') toast.err('Connection was not completed.');
    else toast.ok(`${connected.charAt(0).toUpperCase() + connected.slice(1)} connected`);
    history.replaceState({}, '', window.location.pathname);
  }
}
onMounted(load);
useHead({ title: 'Apps & Integrations — Telroi' });

function appleSvg() { return '<svg viewBox="0 0 24 24" width="22" height="22" fill="#fff"><path d="M15.8 12.6c0-2 1.6-3 1.7-3.1-.9-1.4-2.4-1.6-2.9-1.6-1.2-.1-2.4.7-3 .7-.6 0-1.6-.7-2.6-.7-1.3 0-2.6.8-3.2 2-1.4 2.4-.4 6 1 8 .6 1 1.4 2.1 2.4 2 .9 0 1.3-.6 2.4-.6 1.1 0 1.4.6 2.4.6 1 0 1.6-1 2.2-2 .7-1.1 1-2.1 1-2.2 0 0-1.9-.7-1.9-2.8zM13.9 6.3c.5-.6.9-1.5.8-2.3-.8 0-1.7.5-2.2 1.1-.5.5-.9 1.4-.8 2.2.8.1 1.7-.4 2.2-1z"/></svg>'; }
function androidSvg() { return '<svg viewBox="0 0 24 24" width="22" height="22" fill="#fff"><path d="M6 9v8a1 1 0 0 0 1 1h1v3a1 1 0 0 0 2 0v-3h4v3a1 1 0 0 0 2 0v-3h1a1 1 0 0 0 1-1V9H6zm-2 0a1 1 0 0 0-1 1v5a1 1 0 0 0 2 0v-5a1 1 0 0 0-1-1zm16 0a1 1 0 0 0-1 1v5a1 1 0 0 0 2 0v-5a1 1 0 0 0-1-1zM15.5 4l1-1.7a.3.3 0 0 0-.5-.3L15 3.6a6 6 0 0 0-6 0L7.9 2a.3.3 0 1 0-.5.3l1 1.7A5.4 5.4 0 0 0 6 8h12a5.4 5.4 0 0 0-2.5-4zM9.5 6.2a.6.6 0 1 1 0-1.2.6.6 0 0 1 0 1.2zm5 0a.6.6 0 1 1 0-1.2.6.6 0 0 1 0 1.2z"/></svg>'; }
function windowsSvg() { return '<svg viewBox="0 0 24 24" width="22" height="22" fill="#fff"><path d="M3 5.5l8-1.1v7.2H3V5.5zm0 13l8 1.1v-7.1H3v6zM12 4.2L21 3v8.6h-9V4.2zm0 8.4h9V21l-9-1.2v-7.2z"/></svg>'; }
function dotSvg(c: string) { return `<svg viewBox="0 0 24 24" width="20" height="20" fill="${c}"><circle cx="12" cy="12" r="6"/></svg>`; }
function linuxSvg() { return '<svg viewBox="0 0 24 24" width="22" height="22" fill="#fff"><path d="M12 2c-1.7 0-3 1.6-3 3.6 0 1 .3 1.7.3 2.4 0 .8-.7 1.4-1.3 2.5-.7 1.1-1.5 2.4-1.5 4.2 0 .5-.4 1-.8 1.6-.3.5-.6 1-.6 1.6 0 1 .9 1.5 2 1.8.6.2 1.2.5 1.8.9.4.3.9.4 1.4.4h2.8c.5 0 1-.1 1.4-.4.6-.4 1.2-.7 1.8-.9 1.1-.3 2-.8 2-1.8 0-.6-.3-1.1-.6-1.6-.4-.6-.8-1.1-.8-1.6 0-1.8-.8-3.1-1.5-4.2-.6-1.1-1.3-1.7-1.3-2.5 0-.7.3-1.4.3-2.4C15 3.6 13.7 2 12 2zm-1.3 4.2c.4 0 .7.4.7.9s-.3.9-.7.9-.7-.4-.7-.9.3-.9.7-.9zm2.6 0c.4 0 .7.4.7.9s-.3.9-.7.9-.7-.4-.7-.9.3-.9.7-.9z"/></svg>'; }
function browserSvg() { return '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#fff" stroke-width="1.6"><circle cx="12" cy="12" r="9"/><path d="M3 9h18M3 15h18M12 3c2.5 2.5 2.5 15 0 18M12 3c-2.5 2.5-2.5 15 0 18"/></svg>'; }
</script>

<style scoped>
.ai-subnav { display: flex; gap: 2px; border-bottom: 1px solid var(--rule); margin-bottom: 16px; }
.ai-subtab { padding: 9px 16px; font-size: 13px; color: var(--ink-soft); border-bottom: 2px solid transparent; margin-bottom: -1px; }
.ai-subtab:hover { color: var(--ink); }
.ai-subtab.on { color: var(--signal); border-bottom-color: var(--signal); font-weight: 500; }
.ai-toolbar { display: flex; gap: 12px; align-items: center; margin-bottom: 18px; flex-wrap: wrap; }
.ai-search { flex: 1; min-width: 200px; }
.ai-filters { display: flex; gap: 6px; }
.ai-chip { padding: 6px 13px; font-size: 12.5px; border: 1px solid var(--rule); border-radius: 999px; color: var(--ink-soft); background: var(--paper); }
.ai-chip:hover { border-color: var(--ink-mute); }
.ai-chip.on { background: var(--ink); color: var(--paper); border-color: var(--ink); }
.ai-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 14px; }
.ai-card { background: var(--paper); border: 1px solid var(--rule); border-radius: var(--radius-lg); padding: 18px; display: flex; flex-direction: column; gap: 14px; transition: border-color 0.12s, box-shadow 0.12s; }
.ai-card:hover { border-color: var(--rule-2); box-shadow: 0 4px 16px rgba(0,0,0,0.05); }
.ai-card-icon { width: 46px; height: 46px; border-radius: 12px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.ai-card-body { flex: 1; }
.ai-card-title { font-size: 15px; font-weight: 600; display: flex; align-items: center; gap: 8px; }
.ai-connected { font-size: 10.5px; font-weight: 600; color: #1a7a4f; background: #e7f4ee; padding: 1px 8px; border-radius: 999px; }
.ai-soon { font-size: 10.5px; font-weight: 600; color: var(--ink-mute); background: var(--paper-3, var(--paper-2)); padding: 1px 8px; border-radius: 999px; margin-left: 8px; }
.ai-card-desc { font-size: 13px; color: var(--ink-soft); margin-top: 4px; line-height: 1.5; }
.ai-card-meta { font-size: 11.5px; color: var(--ink-mute); margin-top: 8px; }
.ai-card-actions { display: flex; gap: 8px; align-items: center; }
.ai-dl { display: inline-flex; align-items: center; gap: 6px; flex: 1; justify-content: center; }
.ai-settings { width: 34px; height: 34px; display: flex; align-items: center; justify-content: center; border: 1px solid var(--rule); border-radius: var(--radius); color: var(--ink-soft); }
.ai-settings:hover { color: var(--ink); border-color: var(--ink-mute); }
.ai-empty { grid-column: 1 / -1; padding: 30px; text-align: center; }
.ai-modal-overlay { position: fixed; inset: 0; z-index: 200; background: rgba(10,10,11,0.32); display: flex; align-items: center; justify-content: center; padding: 24px; }
.modal { width: 100%; max-width: 420px; background: var(--paper); }
.ai-x { color: var(--ink-mute); font-size: 15px; }
.ai-modal-lede { font-size: 13px; line-height: 1.5; margin-bottom: 14px; }
.ai-toggle { display: flex; align-items: center; gap: 9px; font-size: 13.5px; padding: 8px 0; }
.ai-settings-btn { margin-left: auto; padding: 6px 8px; color: var(--ink-mute); display: flex; align-items: center; }
.ai-settings-btn:hover { color: var(--ink); }
.ai-settings-modal { max-width: 520px; }
.ai-card-logo { width: 46px; height: 46px; border-radius: 12px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; background: var(--paper-2); border: 1px solid var(--rule); overflow: hidden; }
.ai-card-logo img { width: 30px; height: 30px; object-fit: contain; }
.ai-errored { font-size: 10.5px; font-weight: 600; color: var(--danger); background: rgba(192,57,43,0.1); padding: 1px 8px; border-radius: 999px; }
.ai-connect-modal, .ai-configure-modal { max-width: 480px; }
.ai-modes { display: flex; flex-direction: column; gap: 10px; margin-bottom: 16px; }
.ai-mode { display: flex; align-items: flex-start; gap: 10px; padding: 12px 14px; border: 1px solid var(--rule); border-radius: var(--radius); cursor: pointer; transition: border-color .12s, background .12s; }
.ai-mode.on { border-color: var(--signal); background: var(--signal-soft, var(--paper-2)); }
.ai-mode input { margin-top: 3px; flex: none; }
.ai-mode span { display: flex; flex-direction: column; gap: 2px; }
.ai-mode strong { font-size: 13.5px; font-weight: 600; color: var(--ink); }
.ai-mode small { font-size: 12px; color: var(--ink-soft); line-height: 1.4; }
.ai-cfg-sec { padding: 16px 0; border-top: 1px solid var(--rule); }
.ai-cfg-sec:first-child { border-top: none; padding-top: 0; }
.ai-cfg-h { font-size: 13px; font-weight: 600; margin: 0 0 6px; }
.ai-cfg-p { font-size: 12.5px; line-height: 1.5; margin: 0 0 10px; }
.ai-cfg-err { font-size: 12px; color: var(--danger); margin-top: 8px; }
.ai-key-row { display: flex; gap: 8px; }
.ai-key-row .input { flex: 1; }
.ai-evt-add { display: flex; gap: 8px; margin-bottom: 10px; }
.ai-evt-add .select { max-width: 170px; }
.ai-evt-add .input { flex: 1; }
.ai-evt-list { display: flex; flex-direction: column; gap: 6px; }
.ai-evt-row { display: flex; align-items: center; gap: 10px; padding: 8px 12px; border: 1px solid var(--rule); border-radius: var(--radius); font-size: 12.5px; }
.ai-evt-name { font-weight: 500; white-space: nowrap; }
.ai-evt-url { flex: 1; color: var(--ink-mute); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ai-evt-del { color: var(--ink-mute); }
.ai-evt-del:hover { color: var(--danger); }
.ai-oauth { display: flex; flex-direction: column; }
.ai-manual-toggle { margin: 14px auto 0; font-size: 12.5px; color: var(--ink-mute); text-decoration: underline; }
.ai-manual-toggle:hover { color: var(--ink); }
</style>
