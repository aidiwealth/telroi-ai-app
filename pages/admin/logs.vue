<template>
  <div>
    <h1 class="ad-title">Logs</h1>
    <p class="ad-sub">Lightweight activity across the platform. Entries are retained for 60 days, then automatically removed.</p>

    <div class="log-tabs">
      <button class="log-tab" :class="{ active: kind === 'system' }" @click="setKind('system')">System logs</button>
      <button class="log-tab" :class="{ active: kind === 'call' }" @click="setKind('call')">Call logs</button>
      <button v-if="isSuper" class="log-tab" :class="{ active: kind === 'audit' }" @click="setKind('audit')">Audit log</button>
      <button class="log-tab" :class="{ active: kind === 'webhook' }" @click="setKind('webhook')">Webhooks</button>
      <button v-if="isSuper" class="log-tab" :class="{ active: kind === 'pbx' }" @click="setKind('pbx')">PBX live</button>
    </div>

    <!-- Both were their own pages. They are logs, and looking for one meant
         knowing which of three places to look. PBX stays superadmin-only, as it
         was when it had its own route. -->
    <!-- Named by filename, not path: nuxt.config sets pathPrefix false, so an
         Admin-prefixed tag resolves to nothing and Vue renders an empty tab
         without failing the build. -->
    <WebhookLogs v-if="kind === 'webhook'" />
    <PbxLogs v-else-if="kind === 'pbx' && isSuper" />

    <!-- Audit search (audit tab only) -->
    <div v-if="kind === 'audit'" class="aud-filters">
      <div class="aud-search">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="7" cy="7" r="5"/><path d="M11 11l3.5 3.5" stroke-linecap="round"/></svg>
        <input v-model="auditQ" class="aud-input" placeholder="Search operator, action, or path…" @input="debouncedAudit" />
      </div>
      <select v-model="auditActor" class="aud-select" @change="onAuditFilter">
        <option value="">All operators</option>
        <option v-for="a in auditActors" :key="a" :value="a">{{ a }}</option>
      </select>
    </div>

    <div v-if="pending && kind !== 'webhook' && kind !== 'pbx'" class="ad-loading">Loading…</div>
    <EmptyState v-else-if="kind === 'system' && !logs.length" icon="generic" title="No logs yet" description="Activity across the platform will show up here as it happens." />
    <EmptyState v-else-if="kind === 'call' && !calls.length" icon="calls" title="No calls yet" description="Every call attempt across all clients — including failures — will appear here." />

    <!-- System logs -->
    <div v-else-if="kind === 'system'" class="set-card log-table-wrap">
      <table class="log-table">
        <thead>
          <tr><th>When</th><th>Workspace</th><th>Action</th><th>Detail</th></tr>
        </thead>
        <tbody>
          <tr v-for="l in logs" :key="l.id" :class="l.level">
            <td class="log-time mono">{{ fmt(l.createdAt) }}</td>
            <td class="log-ws">{{ l.workspace || '—' }}</td>
            <td><span class="log-action" :class="l.level">{{ l.action }}</span></td>
            <td class="log-summary">{{ l.summary || '—' }}</td>
          </tr>
        </tbody>
      </table>
      <Pagination v-bind="logMeta" query-key="log" @change="goLogPage" />
    </div>

    <!-- Call logs (system-wide, every client, incl. failures) -->
    <div v-else-if="kind === 'call'" class="set-card log-table-wrap">
      <table class="log-table">
        <thead>
          <tr><th>When</th><th>Workspace</th><th>Direction</th><th>Number</th><th>Status</th><th>Reason</th><th>Recording</th></tr>
        </thead>
        <tbody>
          <tr v-for="c in calls" :key="c.id">
            <td class="log-time mono">{{ fmt(c.startedAt) }}</td>
            <td class="log-ws">{{ c.workspace }}</td>
            <td>{{ c.direction === 'in' ? 'Inbound' : 'Outbound' }}</td>
            <td class="mono">{{ c.phone }}</td>
            <td><span class="chip" :class="c.failed ? 'chip--bad' : 'chip--ok'">{{ c.status }}</span></td>
            <td class="log-summary">{{ c.reason || '—' }}</td>
            <!-- Inline rather than behind a click: an operator scanning for the
                 call somebody is complaining about wants to hear it there, not
                 open a panel first. Loaded only when played — a page of fifty
                 rows should not fetch fifty recordings nobody asked for. -->
            <td>
              <audio v-if="recordings[c.callid]" class="log-audio" controls preload="none"
                     :src="`/api/admin/recordings/${recordings[c.callid]}/audio`"></audio>
              <span v-else class="ad-dim">—</span>
            </td>
          </tr>
        </tbody>
      </table>
      <LoadMore :has-more="!!callsCursor" :loading="loadingMore" @more="loadMoreCalls" />
    </div>

    <!-- Audit log (superadmin only): who did what in the operator console -->
    <div v-else-if="kind === 'audit'" class="set-card log-table-wrap">
      <table class="log-table">
        <thead>
          <tr><th>When</th><th>Operator</th><th>Action</th><th>Path</th><th>Result</th></tr>
        </thead>
        <tbody>
          <tr v-for="e in audit" :key="e.id">
            <td class="log-time mono">{{ fmt(e.createdAt) }}</td>
            <td><strong>{{ e.actorEmail }}</strong><span v-if="e.actorRole" class="aud-role" :class="e.actorRole">{{ e.actorRole }}</span></td>
            <td class="mono">{{ e.action }}</td>
            <td class="log-summary mono">{{ e.method }} {{ e.path }}</td>
            <td><span class="aud-status" :class="auditStatusClass(e.status)">{{ e.status || '—' }}</span></td>
          </tr>
          <tr v-if="!audit.length"><td colspan="5" class="log-summary" style="text-align:center;padding:20px;color:var(--ink-mute)">No audit entries match.</td></tr>
        </tbody>
      </table>
      <Pagination v-bind="auditMeta" query-key="aud" @change="goAuditPage" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
definePageMeta({ layout: 'admin' });
useHead({ title: 'Logs — Telroi Operator' });

const kind = ref<'system' | 'call' | 'audit'>('system');
const logs = ref<any[]>([]);
const calls = ref<any[]>([]);
const callsCursor = ref<string | null>(null);
const loadingMore = ref(false);
const pending = ref(true);

// Audit tab (superadmin only)
const isSuper = ref(false);
const audit = ref<any[]>([]);
const auditActors = ref<string[]>([]);
const auditQ = ref('');
const auditActor = ref('');
let auditTimer: any = null;
function auditStatusClass(s: number) { if (!s) return 'mute'; if (s < 300) return 'ok'; if (s < 500) return 'warn'; return 'err'; }
async function loadAudit() {
  pending.value = true;
  try {
    const params = new URLSearchParams();
    if (auditQ.value.trim()) params.set('q', auditQ.value.trim());
    if (auditActor.value) params.set('actor', auditActor.value);
    params.set('page', String(auditPage.value));
    const r = await $fetch<any>(`/api/admin/audit?${params.toString()}`);
    audit.value = r.entries || [];
    auditMeta.value = { page: r.page || 1, pages: r.pages || 1, total: r.total || 0, perPage: r.perPage || 50 };
    if (r.actors?.length) auditActors.value = r.actors;
  } catch (e: any) {
    if (e?.statusCode === 403) { kind.value = 'system'; await load(); } // not a superadmin
  } finally { pending.value = false; }
}
function debouncedAudit() { clearTimeout(auditTimer); auditTimer = setTimeout(onAuditFilter, 300); }

function fmt(d: string) {
  const dt = new Date(d);
  return dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' + dt.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}
async function load() {
  pending.value = true;
  try {
    if (kind.value === 'audit') { await loadAudit(); return; }
    if (kind.value === 'call') {
      const r = await $fetch<any>('/api/admin/calls');
      calls.value = r.calls; callsCursor.value = r.nextCursor;
    } else {
      const lr = await $fetch<any>('/api/admin/logs', { query: { kind: kind.value, page: logPage.value } });
      logs.value = lr.logs;
      logMeta.value = { page: lr.page || 1, pages: lr.pages || 1, total: lr.total || 0, perPage: lr.perPage || 100 };
    }
  }
  catch (e: any) { if (e?.statusCode === 401) await navigateTo('/admin/login'); }
  finally { pending.value = false; }
}
async function loadMoreCalls() {
  if (!callsCursor.value || loadingMore.value) return;
  loadingMore.value = true;
  try {
    const r = await $fetch<any>('/api/admin/calls', { query: { cursor: callsCursor.value } });
    calls.value.push(...r.calls); callsCursor.value = r.nextCursor;
  } catch { /* */ }
  finally { loadingMore.value = false; }
}
const auditPage = ref(Number(useRoute().query.aud) || 1);
const auditMeta = ref({ page: 1, pages: 1, total: 0, perPage: 50 });
async function goAuditPage(p: number) { auditPage.value = p; await loadAudit(); }

// Searching or changing operator starts again at the first page: page four of
// an unfiltered list is rarely page four of a filtered one.
function onAuditFilter() { auditPage.value = 1; loadAudit(); }

// Recordings, keyed by the call they belong to. Fetched once for the page
// rather than asked for per row.
const recordings = ref<Record<string, string>>({});
async function loadRecordings() {
  try {
    const r = await $fetch<any>('/api/admin/recordings?perPage=200');
    const map: Record<string, string> = {};
    for (const rec of r.items || []) map[rec.callid] = rec.id;
    recordings.value = map;
  } catch { /* the log is still worth showing */ }
}

const logPage = ref(Number(useRoute().query.log) || 1);
const logMeta = ref({ page: 1, pages: 1, total: 0, perPage: 100 });
async function goLogPage(p: number) { logPage.value = p; await load(); }

function setKind(k: 'system' | 'call' | 'audit' | 'webhook' | 'pbx') {
  kind.value = k;
  // Switching tabs while on page five would ask for page five of a different
  // list, which shows an empty table and looks like a fault.
  logPage.value = 1;
  // The webhook and PBX tabs are components that load their own data; calling
  // load() here would fetch system logs nobody is looking at.
  if (k === 'webhook' || k === 'pbx') return;
  load();
}
onMounted(async () => {
  loadRecordings();
  try { const r = await $fetch<any>('/api/admin/me'); isSuper.value = r?.admin?.role === 'superadmin'; } catch { /* */ }
  await load();
});
</script>

<style scoped>
.log-audio { height: 32px; max-width: 220px; }
/* Audit tab */
.aud-filters { display: flex; gap: 12px; margin-bottom: 16px; flex-wrap: wrap; }
.aud-search { position: relative; flex: 1; min-width: 240px; display: flex; align-items: center; }
.aud-search svg { position: absolute; left: 12px; width: 15px; height: 15px; color: var(--ink-mute); }
.aud-input { width: 100%; padding: 9px 14px 9px 34px; border: 1px solid var(--rule); border-radius: var(--radius); font-size: 14px; outline: none; background: var(--paper); color: var(--ink); }
.aud-input:focus { border-color: var(--signal); box-shadow: 0 0 0 3px var(--signal-soft); }
.aud-select { padding: 9px 14px; border: 1px solid var(--rule); border-radius: var(--radius); font-size: 14px; background: var(--paper); color: var(--ink); cursor: pointer; }
.aud-role { font-size: 10.5px; padding: 1px 7px; border-radius: 999px; margin-left: 8px; }
.aud-role.superadmin { background: rgba(26,75,114,0.12); color: var(--signal); }
.aud-role.staff { background: rgba(138,138,147,0.16); color: #6b6b73; }
.aud-status { font-family: var(--font-mono); font-size: 12px; font-weight: 600; padding: 2px 8px; border-radius: 6px; }
.aud-status.ok { background: rgba(0,210,138,0.12); color: #0a8a5c; }
.aud-status.warn { background: rgba(200,150,46,0.14); color: #9a6f15; }
.aud-status.err { background: rgba(192,57,43,0.12); color: #c0392b; }
.aud-status.mute { color: var(--ink-mute); }
.ad-title { font-family: var(--font-display); font-size: 30px; color: var(--ink); letter-spacing: -0.02em; }
.ad-sub { color: var(--ink-mute); font-size: 14px; margin: 4px 0 20px; }
.ad-loading, .ad-empty { color: var(--ink-mute); padding: 40px 0; }
.set-card { background: var(--paper); border: 1px solid var(--rule); border-radius: var(--radius-lg); overflow: hidden; }
.log-table { width: 100%; border-collapse: collapse; }
.log-table th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--ink-mute); font-weight: 500; padding: 12px 18px; border-bottom: 1px solid var(--rule); }
.log-table td { padding: 11px 18px; border-bottom: 1px solid var(--rule-2); font-size: 13px; color: var(--ink); vertical-align: top; }
.log-table tr:last-child td { border-bottom: none; }
.log-time { color: var(--ink-mute); white-space: nowrap; font-size: 12px; }
.log-ws { color: var(--ink-soft); }
.log-action { font-family: var(--font-mono); font-size: 12px; color: var(--signal-2); background: var(--paper-2); padding: 2px 7px; border-radius: 4px; }
.log-action.warn { color: var(--warn); background: rgba(183,121,31,0.1); }
.log-action.error { color: var(--danger); background: rgba(192,57,43,0.1); }
.log-summary { color: var(--ink-soft); }
</style>
