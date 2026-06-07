<template>
  <div>
    <div class="ad-head-row">
      <div>
        <h1 class="ad-title">Status</h1>
        <p class="ad-sub">Incidents and component descriptions for your public status page (<a href="/status" target="_blank">/status</a>). Component <strong>titles and uptime are tracked automatically</strong> from live health checks — you edit descriptions, ordering, incidents, and optional status overrides. Set a custom subdomain under Settings → Platform.</p>
      </div>
    </div>

    <div v-if="pending" class="ad-loading">Loading…</div>
    <template v-else>
      <!-- Components (predetermined, auto-tracked) -->
      <div class="ad-panel">
        <div class="ad-panel-h"><span>Components</span><span class="ad-dim" style="font-weight:400;font-size:12.5px">Auto-tracked · title &amp; uptime are derived from live health checks</span></div>
        <table class="ad-table">
          <thead><tr><th>Component</th><th>Live status</th><th>Uptime (90d)</th><th>Override</th><th>Sort</th><th></th></tr></thead>
          <tbody>
            <tr v-for="c in components" :key="c.key">
              <td><strong>{{ c.title }}</strong><div class="ad-dim" style="font-size:12px">{{ c.description }}</div></td>
              <td><span class="ad-tag" :class="c.status === 'operational' ? 'ok' : (c.status === 'unknown' ? 'mute' : 'warn')">{{ c.monitored || c.status !== 'operational' ? c.status : 'not monitored' }}</span></td>
              <td class="ad-dim mono">{{ c.uptime90 != null ? (c.uptime90/100).toFixed(2) + '%' : '—' }}</td>
              <td><span class="ad-dim" style="font-size:12px">{{ c.manualStatus || 'Auto' }}</span></td>
              <td class="ad-dim mono">{{ c.sortOrder }}</td>
              <td style="text-align:right"><button class="ad-link-btn" @click="openComp(c)">Edit</button></td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Incidents -->
      <div class="ad-panel" style="margin-top:24px">
        <div class="ad-panel-h"><span>Incidents</span><button class="btn btn-signal btn-sm" @click="openInc()">+ Report incident</button></div>
        <table class="ad-table">
          <thead><tr><th>Title</th><th>Status</th><th>Impact</th><th>Started</th><th></th></tr></thead>
          <tbody>
            <tr v-for="i in incidents" :key="i.id">
              <td>{{ i.title }}</td>
              <td><span class="ad-tag" :class="i.status === 'resolved' ? 'ok' : 'warn'">{{ i.status }}</span></td>
              <td class="ad-dim">{{ i.impact }}</td>
              <td class="ad-dim mono">{{ fmt(i.startedAt) }}</td>
              <td style="text-align:right"><button class="ad-link-btn" @click="openInc(i)">Update</button></td>
            </tr>
            <tr v-if="!incidents.length"><td colspan="5" class="ad-none">No incidents reported.</td></tr>
          </tbody>
        </table>
      </div>
    </template>

    <!-- Component modal (edit-only: description, sort, override) -->
    <div v-if="comp" class="ad-modal-overlay" @click.self="comp = null">
      <div class="ad-modal">
        <div class="ad-modal-head"><h3>{{ comp.title }}</h3><button class="ad-x" @click="comp = null">✕</button></div>
        <p class="ad-dim" style="font-size:12.5px;margin:-6px 0 14px">Title and uptime are determined automatically by health checks. You can edit the description, ordering, and optionally override the status (e.g. for planned maintenance).</p>
        <div class="ad-field"><label>Description</label><input v-model="comp.description" class="ad-input" placeholder="One-time passcode delivery" /></div>
        <div class="ad-row">
          <div class="ad-field"><label>Status override</label><select v-model="comp.manualStatus" class="ad-input"><option :value="null">Auto (use live checks)</option><option value="operational">Operational</option><option value="degraded">Degraded</option><option value="partial_outage">Partial outage</option><option value="major_outage">Major outage</option><option value="maintenance">Maintenance</option></select></div>
          <div class="ad-field"><label>Sort order</label><input v-model.number="comp.sortOrder" type="number" class="ad-input" /></div>
        </div>
        <button class="btn btn-signal btn-block" :disabled="saving" @click="saveComp">{{ saving ? 'Saving…' : 'Save' }}</button>
      </div>
    </div>

    <!-- Incident modal -->
    <div v-if="inc" class="ad-modal-overlay" @click.self="inc = null">
      <div class="ad-modal">
        <div class="ad-modal-head"><h3>{{ inc.id ? 'Update incident' : 'Report incident' }}</h3><button class="ad-x" @click="inc = null">✕</button></div>
        <div class="ad-field"><label>Title</label><input v-model="inc.title" class="ad-input" placeholder="Elevated OTP latency" /></div>
        <div class="ad-row">
          <div class="ad-field"><label>Status</label><select v-model="inc.status" class="ad-input"><option value="investigating">Investigating</option><option value="identified">Identified</option><option value="monitoring">Monitoring</option><option value="resolved">Resolved</option></select></div>
          <div class="ad-field"><label>Impact</label><select v-model="inc.impact" class="ad-input"><option value="none">None</option><option value="minor">Minor</option><option value="major">Major</option><option value="critical">Critical</option><option value="maintenance">Maintenance</option></select></div>
        </div>
        <div class="ad-field"><label>Update message</label><textarea v-model="inc.body" class="ad-input" rows="3" placeholder="We are investigating reports of…"></textarea></div>
        <button class="btn btn-signal btn-block" :disabled="saving || !inc.title" @click="saveInc">{{ saving ? 'Saving…' : 'Save update' }}</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
definePageMeta({ layout: 'admin' });
useHead({ title: 'Status — Telroi Operator' });

const pending = ref(true);
const components = ref<any[]>([]);
const incidents = ref<any[]>([]);
const comp = ref<any>(null);
const inc = ref<any>(null);
const saving = ref(false);

function fmt(iso: string) { return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); }
function openComp(c?: any) { comp.value = c ? { key: c.key, title: c.title, description: c.description || '', manualStatus: c.manualStatus ?? null, sortOrder: c.sortOrder ?? 0 } : null; }
function openInc(i?: any) { inc.value = i ? { ...i } : { title: '', status: 'investigating', impact: 'minor', body: '' }; }

async function load() {
  try { const r = await $fetch<any>('/api/admin/status'); components.value = r.components || []; incidents.value = r.incidents || []; }
  catch (e: any) { if (e?.statusCode === 401) await navigateTo('/admin/login'); }
  finally { pending.value = false; }
}
async function saveComp() {
  saving.value = true;
  try {
    await $fetch('/api/admin/status/component', { method: 'POST', body: {
      key: comp.value.key,
      description: comp.value.description,
      sortOrder: comp.value.sortOrder,
      manualStatus: comp.value.manualStatus
    } });
    comp.value = null; await load();
  } catch (e: any) { alert(e?.data?.error?.message || 'Could not save'); }
  finally { saving.value = false; }
}
async function saveInc() {
  saving.value = true;
  try { await $fetch('/api/admin/status/incident', { method: 'POST', body: { ...inc.value } }); inc.value = null; await load(); }
  catch (e: any) { alert(e?.data?.error?.message || 'Could not save'); }
  finally { saving.value = false; }
}
onMounted(load);
</script>

<style scoped>
.ad-head-row { margin-bottom: 18px; }
.ad-panel { background: var(--paper); border: 1px solid var(--rule); border-radius: var(--radius-lg); overflow: hidden; }
.ad-panel-h { display: flex; align-items: center; justify-content: space-between; padding: 16px 20px; border-bottom: 1px solid var(--rule); font-weight: 600; }
.ad-table { width: 100%; border-collapse: collapse; }
.ad-table th { text-align: left; font-family: var(--font-mono); font-size: 10.5px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink-mute); font-weight: 500; padding: 12px 20px; border-bottom: 1px solid var(--rule); }
.ad-table td { padding: 12px 20px; border-bottom: 1px solid var(--rule-2); font-size: 14px; }
.ad-tag { font-size: 11.5px; padding: 2px 9px; border-radius: 999px; }
.ad-tag.ok { background: rgba(0,210,138,0.12); color: #0a8a5c; }
.ad-tag.warn { background: rgba(200,150,46,0.14); color: #9a6f15; }
.ad-tag.mute { background: rgba(138,138,147,0.16); color: #6b6b73; }
.ad-link-btn { background: none; border: none; color: var(--signal); cursor: pointer; font-size: 13px; }
.ad-link-danger { color: var(--danger); margin-left: 12px; }
.ad-modal-overlay { position: fixed; inset: 0; z-index: 200; background: rgba(10,10,11,0.32); display: flex; align-items: center; justify-content: center; padding: 24px; }
.ad-modal { width: 100%; max-width: 480px; background: var(--paper); border: 1px solid var(--rule); border-radius: var(--radius-lg); padding: 28px; box-shadow: 0 24px 60px rgba(10,10,11,0.28); animation: adModalPop .2s cubic-bezier(.16,1,.3,1); max-height: 90vh; overflow-y: auto; }
@keyframes adModalPop { from { opacity: 0; transform: translateY(8px) scale(.98); } to { opacity: 1; transform: translateY(0) scale(1); } }
.ad-modal-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 18px; }
.ad-modal-head h3 { font-family: var(--font-display); font-size: 21px; }
.ad-field { display: flex; flex-direction: column; gap: 6px; margin-bottom: 14px; }
.ad-field label { font-size: 13px; font-weight: 500; }
.ad-row { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.ad-input { padding: 11px 14px; border: 1px solid var(--rule); border-radius: var(--radius); font-size: 14.5px; outline: none; background: var(--paper); color: var(--ink); width: 100%; font-family: inherit; }
.ad-input:focus { border-color: var(--signal); box-shadow: 0 0 0 3px var(--signal-soft); }
.ad-x { background: none; border: none; font-size: 16px; color: var(--ink-mute); cursor: pointer; }
.ad-none { text-align: center; color: var(--ink-mute); padding: 20px; }
.mono { font-family: var(--font-mono); }
</style>
