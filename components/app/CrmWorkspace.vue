<template>
  <div>
    <div class="page-head crm-pagehead">
      <div>
        <h1 class="page-title">CRM</h1>
        <p class="page-sub">Your customers and leads — every call logged against the right contact, with notes, location and history.</p>
      </div>
      <div v-if="!locked" class="crm-head-actions">
        <button class="btn btn-ghost btn-sm" @click="showSettings = true">Settings</button>
        <button class="btn btn-ghost btn-sm" @click="openImport">Import contacts</button>
        <button class="btn btn-signal btn-sm" @click="openNew">+ New contact</button>
      </div>
    </div>

    <FeatureGate feature="crm" :bypass="admin" title="Telroi CRM" blurb="Contacts, call history, notes and location — every inbound web call auto-linked to the right customer.">
      <!-- Source sub-menu: groups the six sources into manageable buckets -->
      <div class="crm-subnav">
        <button v-for="b in buckets" :key="b.key" class="crm-subtab" :class="{ on: bucket === b.key }" @click="setBucket(b.key)">
          {{ b.label }}
        </button>
      </div>

      <!-- Toolbar -->
      <div class="crm-toolbar">
        <input v-model="q" class="input crm-search" placeholder="Search name, company, phone, email…" @input="debouncedLoad" />
        <select v-model="status" class="select crm-filter" @change="load">
          <option value="all">All statuses</option>
          <option value="lead">Leads</option>
          <option value="active">Active</option>
          <option value="customer">Customers</option>
          <option value="churned">Churned</option>
        </select>
        <div class="crm-view-toggle">
          <button class="crm-vbtn" :class="{ on: view === 'table' }" title="Table view" @click="view = 'table'">
            <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="2" y="3" width="12" height="10" rx="1"/><path d="M2 6.5h12M6 6.5V13"/></svg>
          </button>
          <button class="crm-vbtn" :class="{ on: view === 'kanban' }" title="Board view" @click="view = 'kanban'">
            <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="2" y="3" width="3.5" height="10" rx="1"/><rect x="6.25" y="3" width="3.5" height="7" rx="1"/><rect x="10.5" y="3" width="3.5" height="9" rx="1"/></svg>
          </button>
        </div>
      </div>

      <div v-if="view === 'table'" class="card crm-table">
        <div v-if="pending" class="crm-pad"><div v-for="i in 5" :key="i" class="skeleton skel-row" /></div>
        <table v-else-if="contacts.length" class="table">
          <thead><tr><th>Contact</th><th>Phone</th><th>Location</th><th>Source</th><th>Status</th><th>Last contacted</th></tr></thead>
          <tbody>
            <tr v-for="c in contacts" :key="c.id" class="clickable" @click="open(c)">
              <td>
                <div class="crm-id">
                  <span class="crm-avatar">{{ initials(c) }}</span>
                  <div><div class="crm-name">{{ c.name || 'Unknown' }}</div><div class="crm-company">{{ c.company || '—' }}</div></div>
                </div>
              </td>
              <td class="mono">{{ c.phone || '—' }}</td>
              <td>{{ loc(c) }}</td>
              <td><span class="crm-source">{{ srcLabel(c.source) }}</span></td>
              <td><span class="crm-status" :class="c.status">{{ c.status }}</span></td>
              <td class="muted">{{ c.lastContactedAt ? fmtDate(c.lastContactedAt) : '—' }}</td>
            </tr>
          </tbody>
        </table>
        <EmptyState v-else icon="team" title="No contacts yet" description="Add a contact, or they’ll appear automatically when customers call you on the web." />
      </div>

      <!-- Kanban board: columns by status, filtered by the active source bucket -->
      <div v-else class="crm-board">
        <div v-for="col in board" :key="col.key" class="crm-col"
             :class="{ 'crm-col-over': dragOverCol === col.key }"
             @dragover.prevent="dragOverCol = col.key"
             @dragleave="onColLeave(col.key)"
             @drop="onCardDrop(col.key)">
          <div class="crm-col-head">
            <span class="crm-col-dot" :class="col.key" />
            {{ col.label }}
            <span class="crm-col-count">{{ col.items.length }}</span>
          </div>
          <div class="crm-col-body">
            <div v-for="c in col.items" :key="c.id" class="crm-kcard"
                 :class="{ 'crm-kcard-dragging': dragId === c.id }"
                 draggable="true"
                 @dragstart="onDragStart(c, $event)"
                 @dragend="onDragEnd"
                 @click="open(c)">
              <div class="crm-kcard-top">
                <span class="crm-avatar sm">{{ initials(c) }}</span>
                <div class="crm-kcard-id">
                  <div class="crm-name">{{ c.name || 'Unknown' }}</div>
                  <div class="crm-company">{{ c.company || c.phone || '—' }}</div>
                </div>
              </div>
              <div class="crm-kcard-meta">
                <span class="crm-source">{{ srcLabel(c.source) }}</span>
                <span class="muted">{{ loc(c) }}</span>
              </div>
            </div>
            <p v-if="!col.items.length" class="crm-col-empty" :class="{ 'crm-col-empty-over': dragOverCol === col.key }">{{ dragOverCol === col.key ? 'Drop here' : 'None' }}</p>
          </div>
        </div>
      </div>
    </FeatureGate>

    <!-- Detail drawer -->
    <div v-if="sel" class="crm-drawer-overlay" @click.self="sel = null">
      <div class="crm-drawer">
        <div class="crm-drawer-head">
          <div class="crm-id">
            <span class="crm-avatar lg">{{ initials(sel) }}</span>
            <div>
              <input v-model="sel.name" class="crm-edit-name" placeholder="Name" @change="save('name', sel.name)" />
              <input v-model="sel.company" class="crm-edit-company" placeholder="Company" @change="save('company', sel.company)" />
            </div>
          </div>
          <button class="crm-x" @click="sel = null">✕</button>
        </div>

        <div class="crm-drawer-actions">
          <button class="btn btn-signal btn-sm" :disabled="!sel.phone" @click="callContact(sel)">Call</button>
          <select :value="sel.status" class="select select-sm" @change="save('status', $event.target.value)">
            <option value="lead">Lead</option><option value="active">Active</option><option value="customer">Customer</option><option value="churned">Churned</option>
          </select>
        </div>

        <div class="crm-fields">
          <label>Phone</label><input v-model="sel.phone" class="input" @change="save('phone', sel.phone)" />
          <label>Email</label><input v-model="sel.email" class="input" @change="save('email', sel.email)" />
          <label>City</label><input v-model="sel.city" class="input" @change="save('city', sel.city)" />
          <label>Region</label><input v-model="sel.region" class="input" @change="save('region', sel.region)" />
          <label>Country</label><input v-model="sel.country" class="input" @change="save('country', sel.country)" />
        </div>

        <!-- Call history -->
        <div class="crm-section-h">Call history</div>
        <div v-if="sel.calls?.length" class="crm-calls">
          <div v-for="c in sel.calls" :key="c.id" class="crm-call">
            <span class="crm-call-dir" :class="c.direction">{{ c.direction === 'in' ? '↓' : '↑' }}</span>
            <span class="mono">{{ c.phone }}</span>
            <span class="muted">{{ fmtDateTime(c.startedAt) }}</span>
            <span class="crm-call-status" :class="{ bad: c.status === 'failed' }">{{ c.status }}</span>
          </div>
        </div>
        <p v-else class="muted crm-none">No calls logged yet.</p>

        <!-- Notes / reports -->
        <div class="crm-section-h">Notes &amp; reports</div>
        <div class="crm-note-add">
          <textarea v-model="newNote" class="input" rows="2" placeholder="Log a note or call report…"></textarea>
          <button class="btn btn-ghost btn-sm" :disabled="!newNote.trim()" @click="addNote">Add</button>
        </div>
        <div v-for="n in sel.notes" :key="n.id" class="crm-note">
          <div class="crm-note-meta"><span class="crm-note-kind">{{ n.kind === 'call_report' ? 'Call report' : 'Note' }}</span><span class="muted">{{ fmtDateTime(n.createdAt) }}</span></div>
          <div class="crm-note-body">{{ n.body }}</div>
        </div>
      </div>
    </div>

    <!-- New contact modal -->
    <div v-if="showNew" class="crm-drawer-overlay" @click.self="showNew = false">
      <div class="modal card">
        <div class="card-head"><span class="card-title">New contact</span><button class="crm-x" @click="showNew = false">✕</button></div>
        <div class="card-pad">
          <div class="field"><label>Name</label><input v-model="draft.name" class="input" /></div>
          <div class="field"><label>Phone</label><input v-model="draft.phone" class="input mono" placeholder="+234…" /></div>
          <div class="field"><label>Company</label><input v-model="draft.company" class="input" /></div>
          <div class="field"><label>Email</label><input v-model="draft.email" class="input" /></div>
          <button class="btn btn-signal btn-block" :disabled="saving || !draft.phone" @click="create">{{ saving ? 'Saving…' : 'Create contact' }}</button>
        </div>
      </div>
    </div>

    <DialerModal v-if="dialer.open" :initial-phone="dialer.phone" :auto-start="true"
      :token-endpoint="admin ? '/api/admin/support/voice-token' : undefined"
      :numbers-endpoint="admin ? '/api/admin/support/numbers' : undefined"
      @close="dialer.open = false" />

    <!-- Settings modal -->
    <div v-if="showSettings" class="crm-drawer-overlay" @click.self="showSettings = false">
      <div class="modal card crm-settings-modal">
        <div class="card-head"><span class="card-title">CRM settings</span><button class="crm-x" @click="showSettings = false">✕</button></div>
        <div class="card-pad"><FeatureSettings feature="crm" /></div>
      </div>
    </div>

    <!-- Import modal with sub-tabs -->
    <div v-if="showImport" class="crm-drawer-overlay" @click.self="closeImport">
      <div class="modal card imp-modal">
        <div class="card-head"><span class="card-title">Import contacts</span><button class="crm-x" @click="closeImport">✕</button></div>
        <div class="card-pad">
          <!-- progress notice -->
          <div v-if="job" class="imp-progress">
            <div class="imp-prog-top">
              <span>{{ job.status === 'done' ? 'Import complete' : job.status === 'failed' ? 'Import failed' : 'Importing…' }}</span>
              <span class="muted">{{ job.processed }}<span v-if="job.total">/{{ job.total }}</span></span>
            </div>
            <div class="imp-bar"><div class="imp-bar-fill" :style="{ width: pct + '%' }" /></div>
            <p class="imp-prog-note muted">
              <template v-if="job.status === 'done'">{{ job.created }} contacts imported{{ job.skipped ? `, ${job.skipped} skipped` : '' }}. You can close this — it ran in the background.</template>
              <template v-else-if="job.status === 'failed'">{{ job.error || 'Something went wrong.' }}</template>
              <template v-else>This continues in the background — you can keep working and check back here.</template>
            </p>
            <button v-if="job.status === 'done' || job.status === 'failed'" class="btn btn-ghost btn-sm" @click="resetImport">Import another</button>
          </div>

          <template v-else>
            <div class="imp-tabs">
              <button class="imp-tab" :class="{ on: impTab === 'file' }" @click="impTab = 'file'">Upload file</button>
              <button class="imp-tab" :class="{ on: impTab === 'drive' }" @click="impTab = 'drive'">Google Drive</button>
            </div>

            <p class="imp-tag-note muted">These contacts will be tagged <strong>{{ impTab === 'drive' ? 'Google' : 'Manual' }}</strong>. API, SIP and direct-call contacts are categorized automatically as they arrive.</p>

            <!-- File / drag-drop -->
            <div v-show="impTab === 'file'">
              <div class="imp-drop" :class="{ over: dragOver }" @dragover.prevent="dragOver = true" @dragleave="dragOver = false" @drop.prevent="onDrop" @click="fileInput?.click()">
                <input ref="fileInput" type="file" accept=".csv,.xlsx,.xls" hidden @change="onPick" />
                <div v-if="file" class="imp-file">{{ file.name }} · {{ (file.size / 1024).toFixed(0) }} KB</div>
                <div v-else class="imp-drop-hint">Drag &amp; drop a CSV or Excel file, or click to browse.<br><span class="muted">Up to 100,000 contacts. Columns: name, phone, email, company, city, country.</span></div>
              </div>
              <button class="btn btn-signal btn-block" :disabled="!file || uploading" @click="startFileImport">{{ uploading ? 'Uploading…' : 'Start import' }}</button>
            </div>

            <!-- Google Drive -->
            <div v-show="impTab === 'drive'">
              <div class="imp-field">
                <label>Google Drive share link</label>
                <input v-model="driveUrl" class="input" placeholder="https://drive.google.com/file/d/…/view" />
                <span class="muted imp-hint">Make sure the file is shared as “Anyone with the link”. CSV or Excel.</span>
              </div>
              <button class="btn btn-signal btn-block" :disabled="!driveUrl || uploading" @click="startDriveImport">{{ uploading ? 'Starting…' : 'Import from Drive' }}</button>
            </div>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue';
const props = withDefaults(defineProps<{ apiBase?: string; admin?: boolean }>(), { apiBase: '/api/crm', admin: false });
const api = useApi();
const toast = useToast();

const { has, load: loadPlan } = usePlan();
// In admin mode the workspace is always available (support workspace); no plan gate.
const locked = computed(() => props.admin ? false : !has('crm'));

const contacts = ref<any[]>([]);
const pending = ref(true);
const q = ref(''); const status = ref('all');

// View + source sub-menu
const view = ref<'table' | 'kanban'>('table');
const bucket = ref<'all' | 'uploads' | 'api' | 'sip' | 'direct'>('all');
const buckets = [
  { key: 'all', label: 'All' },
  { key: 'uploads', label: 'Uploads' },
  { key: 'api', label: 'API' },
  { key: 'sip', label: 'SIP' },
  { key: 'direct', label: 'Direct' }
] as const;
// Which raw sources belong to each bucket.
const BUCKET_SOURCES: Record<string, string[]> = {
  uploads: ['manual', 'google', 'import', 'CRM'],
  api: ['API'],
  sip: ['SIP'],
  direct: ['Direct', 'web_call', 'inbound']
};
function setBucket(k: any) { bucket.value = k; load(); }

// Kanban columns: status-grouped, from the already-filtered `contacts`.
const BOARD_LABELS: Record<string, string> = { lead: 'Leads', active: 'Active', customer: 'Customers', churned: 'Churned' };
const board = computed(() => {
  const cols = [
    { key: 'lead', label: 'Leads', items: [] as any[] },
    { key: 'active', label: 'Active', items: [] as any[] },
    { key: 'customer', label: 'Customers', items: [] as any[] },
    { key: 'churned', label: 'Churned', items: [] as any[] }
  ];
  const by: Record<string, any> = { lead: cols[0], active: cols[1], customer: cols[2], churned: cols[3] };
  for (const c of contacts.value) (by[c.status] || cols[0]).items.push(c);
  return cols;
});
const sel = ref<any>(null);
const newNote = ref('');
const showNew = ref(false);
const saving = ref(false);

// Kanban drag-and-drop: drag a card into another column to change its status.
const dragId = ref<string | null>(null);
const dragOverCol = ref<string | null>(null);
function onDragStart(c: any, e: DragEvent) {
  dragId.value = c.id;
  if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', c.id); } catch { /* */ } }
}
function onDragEnd() { dragId.value = null; dragOverCol.value = null; }
function onColLeave(key: string) { if (dragOverCol.value === key) dragOverCol.value = null; }
async function onCardDrop(colKey: string) {
  const id = dragId.value;
  dragOverCol.value = null;
  dragId.value = null;
  if (!id) return;
  const row = contacts.value.find((c) => c.id === id);
  if (!row || row.status === colKey) return;
  const prev = row.status;
  row.status = colKey; // optimistic — board recomputes immediately
  try {
    await api.put(`${props.apiBase}/contacts/${id}`, { status: colKey });
    // If a status filter is active and the new status no longer matches, drop it from view.
    if (status.value !== 'all' && colKey !== status.value) {
      contacts.value = contacts.value.filter((c) => c.id !== id);
    }
    if (sel.value && sel.value.id === id) sel.value.status = colKey;
    toast.ok(`Moved to ${BOARD_LABELS[colKey] || colKey}`);
  } catch (e: any) {
    row.status = prev; // revert on failure
    toast.err(e?.data?.error?.message || 'Could not move contact');
  }
}
const draft = reactive<any>({ name: '', phone: '', company: '', email: '' });
const dialer = reactive<{ open: boolean; phone: string }>({ open: false, phone: '' });

function initials(c: any) { return ((c.name || c.company || c.phone || '?').trim()[0] || '?').toUpperCase(); }
function loc(c: any) { return [c.city, c.country].filter(Boolean).join(', ') || '—'; }
function fmtDate(d: string) { return new Date(d).toLocaleDateString(); }
function fmtDateTime(d: string) { return new Date(d).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }

let t: any;
function debouncedLoad() { clearTimeout(t); t = setTimeout(load, 300); }

async function load() {
  pending.value = true;
  try {
    const sources = bucket.value === 'all' ? undefined : (BUCKET_SOURCES[bucket.value] || []).join(',');
    const r = await api.get<{ contacts: any[] }>(`${props.apiBase}/contacts`, { q: q.value || undefined, status: status.value, sources });
    contacts.value = r.contacts;
  } catch (e: any) { if (e?.data?.error?.code !== 'feature_locked') toast.err(e?.data?.error?.message || 'Could not load'); }
  finally { pending.value = false; }
}
async function open(c: any) {
  if (dragId.value) return; // ignore the click that can follow a drag
  try { const r = await api.get<{ contact: any }>(`${props.apiBase}/contacts/${c.id}`); sel.value = r.contact; }
  catch (e: any) { toast.err('Could not open contact'); }
}
async function save(field: string, value: any) {
  if (!sel.value) return;
  try {
    await api.put(`${props.apiBase}/contacts/${sel.value.id}`, { [field]: value });
    // Reflect the change in the in-memory list so the Kanban board (and table)
    // reposition the contact immediately — the board is computed off `contacts`.
    const row = contacts.value.find((c) => c.id === sel.value.id);
    if (row) {
      row[field] = value;
      // If a status change pushes the contact out of the active status filter,
      // drop it from the visible list so it doesn't linger in the wrong place.
      if (field === 'status' && status.value !== 'all' && value !== status.value) {
        contacts.value = contacts.value.filter((c) => c.id !== sel.value.id);
      }
    }
  }
  catch (e: any) { toast.err(e?.data?.error?.message || 'Could not save'); }
}
async function addNote() {
  if (!sel.value || !newNote.value.trim()) return;
  try {
    const r = await api.post<{ note: any }>(`${props.apiBase}/contacts/${sel.value.id}/notes`, { body: newNote.value });
    sel.value.notes = [r.note, ...(sel.value.notes || [])];
    newNote.value = '';
  } catch (e: any) { toast.err(e?.data?.error?.message || 'Could not add note'); }
}
function openNew() { Object.assign(draft, { name: '', phone: '', company: '', email: '' }); showNew.value = true; }
async function create() {
  saving.value = true;
  try {
    const body: any = { ...draft }; if (!body.email) delete body.email;
    await api.post(`${props.apiBase}/contacts`, body);
    showNew.value = false; await load(); toast.ok('Contact added');
  } catch (e: any) { toast.err(e?.data?.error?.message || 'Could not create'); }
  finally { saving.value = false; }
}
function callContact(c: any) { dialer.phone = c.phone; dialer.open = true; }

// ── Import ──
const showImport = ref(false);
const showSettings = ref(false);
const impTab = ref<'file' | 'drive'>('file');
const file = ref<File | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);
const dragOver = ref(false);
const driveUrl = ref('');
const uploading = ref(false);
const job = ref<any>(null);
let pollTimer: any = null;
const pct = computed(() => { const j = job.value; if (!j) return 0; if (j.status === 'done') return 100; return j.total ? Math.round((j.processed / j.total) * 100) : 8; });

function srcLabel(s: string) { return ({ manual: 'Manual', google: 'Google', import: 'Import', CRM: 'Manual', API: 'API', SIP: 'SIP', Direct: 'Direct', web_call: 'Web call', inbound: 'Direct' } as any)[s] || s || '—'; }
function openImport() { showImport.value = true; resetImport(); }
function closeImport() { showImport.value = false; stopPoll(); }
function resetImport() { job.value = null; file.value = null; driveUrl.value = ''; impTab.value = 'file'; stopPoll(); }
function onPick(e: Event) { const f = (e.target as HTMLInputElement).files?.[0]; if (f) file.value = f; }
function onDrop(e: DragEvent) { dragOver.value = false; const f = e.dataTransfer?.files?.[0]; if (f) file.value = f; }

function fileTypeOf(name: string) { return /\.xlsx?$/i.test(name) ? 'xlsx' : 'csv'; }

async function startFileImport() {
  if (!file.value) return;
  uploading.value = true;
  try {
    const ft = fileTypeOf(file.value.name);
    const ct = ft === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'text/csv';
    // 1. Ask for a presigned URL (or learn we're in local-dev mode).
    const pre = await api.post<{ key: string; url: string | null; backend: string }>(`${props.apiBase}/import/presign`, { fileName: file.value.name, contentType: ct });
    let key = pre.key;
    if (pre.url) {
      // 2a. Upload directly to R2.
      const put = await fetch(pre.url, { method: 'PUT', headers: { 'Content-Type': ct }, body: file.value });
      if (!put.ok) throw new Error('Upload to storage failed');
    } else {
      // 2b. Local-dev fallback: send through the server.
      const fd = new FormData(); fd.append('file', file.value);
      const up = await $fetch<{ key: string }>(`${props.apiBase}/import/upload-local`, { method: 'POST', body: fd });
      key = up.key;
    }
    // 3. Create the job + start polling.
    const r = await api.post<{ job: any }>(`${props.apiBase}/import`, { source: 'manual', fileName: file.value!.name, fileKey: key, fileType: ft });
    job.value = r.job; startPoll(r.job.id);
  } catch (e: any) { toast.err(e?.data?.error?.message || e?.message || 'Import failed'); }
  finally { uploading.value = false; }
}
async function startDriveImport() {
  if (!driveUrl.value) return;
  uploading.value = true;
  try {
    const ft = /\.xlsx?($|\?)/i.test(driveUrl.value) ? 'xlsx' : 'csv';
    const r = await api.post<{ job: any }>(`${props.apiBase}/import`, { source: 'google', driveUrl: driveUrl.value, fileType: ft });
    job.value = r.job; startPoll(r.job.id);
  } catch (e: any) { toast.err(e?.data?.error?.message || 'Import failed'); }
  finally { uploading.value = false; }
}
function startPoll(id: string) {
  stopPoll();
  pollTimer = setInterval(async () => {
    try {
      const r = await api.get<{ job: any }>(`${props.apiBase}/import/${id}`);
      job.value = r.job;
      if (r.job.status === 'done' || r.job.status === 'failed') { stopPoll(); if (r.job.status === 'done') load(); }
    } catch { /* keep polling */ }
  }, 1500);
}
function stopPoll() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }

onMounted(() => { loadPlan(); load(); });
</script>

<style scoped>
.crm-pagehead { display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; }
.crm-subnav { display: flex; gap: 2px; border-bottom: 1px solid var(--rule); margin-bottom: 16px; }
.crm-subtab { padding: 9px 16px; font-size: 13px; color: var(--ink-soft); border-bottom: 2px solid transparent; margin-bottom: -1px; }
.crm-subtab:hover { color: var(--ink); }
.crm-subtab.on { color: var(--signal); border-bottom-color: var(--signal); font-weight: 500; }
.crm-view-toggle { display: flex; border: 1px solid var(--rule); border-radius: var(--radius); overflow: hidden; }
.crm-vbtn { padding: 7px 10px; color: var(--ink-mute); display: flex; align-items: center; background: var(--paper); }
.crm-vbtn:hover { color: var(--ink-soft); }
.crm-vbtn.on { background: var(--signal-soft); color: var(--signal); }
.crm-board { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; align-items: start; }
@media (max-width: 900px) { .crm-board { grid-template-columns: 1fr 1fr; } }
.crm-col { background: var(--paper-2); border: 1px solid var(--rule); border-radius: var(--radius-lg); padding: 12px; }
.crm-col-head { display: flex; align-items: center; gap: 8px; font-size: 12.5px; font-weight: 600; margin-bottom: 12px; }
.crm-col-dot { width: 8px; height: 8px; border-radius: 50%; }
.crm-col-dot.lead { background: var(--signal); }
.crm-col-dot.active { background: #1a7a4f; }
.crm-col-dot.customer { background: #1a4b72; }
.crm-col-dot.churned { background: var(--ink-mute); }
.crm-col-count { margin-left: auto; color: var(--ink-mute); font-weight: 500; }
.crm-col-body { display: flex; flex-direction: column; gap: 8px; min-height: 40px; }
.crm-kcard { background: var(--paper); border: 1px solid var(--rule); border-radius: var(--radius); padding: 11px; cursor: grab; transition: border-color 0.12s, box-shadow 0.12s, opacity 0.12s; }
.crm-kcard:active { cursor: grabbing; }
.crm-kcard-dragging { opacity: 0.4; border-style: dashed; }
.crm-col-over { border-color: var(--signal); background: var(--signal-soft, var(--paper-3)); box-shadow: inset 0 0 0 1px var(--signal); }
.crm-col-empty-over { color: var(--signal); font-weight: 500; }
.crm-kcard:hover { border-color: var(--signal); box-shadow: 0 2px 8px rgba(0,0,0,0.06); }
.crm-kcard-top { display: flex; gap: 9px; align-items: center; margin-bottom: 8px; }
.crm-kcard-id { min-width: 0; }
.crm-kcard-meta { display: flex; justify-content: space-between; align-items: center; gap: 8px; font-size: 11.5px; }
.crm-avatar.sm { width: 26px; height: 26px; font-size: 11px; }
.crm-col-empty { font-size: 12px; color: var(--ink-mute); padding: 8px 2px; }
.imp-tag-note { font-size: 12px; line-height: 1.5; margin-bottom: 14px; }
.crm-settings-modal { max-width: 520px; }
.crm-toolbar { display: flex; gap: 10px; margin-bottom: 14px; }
.crm-search { flex: 1; }
.crm-filter { width: auto; }
.crm-table { padding: 0; overflow: hidden; }
.crm-pad { padding: 20px; }
.crm-id { display: flex; gap: 10px; align-items: center; }
.crm-avatar { width: 32px; height: 32px; border-radius: 50%; background: var(--signal-soft); color: var(--signal); display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 600; flex-shrink: 0; }
.crm-avatar.lg { width: 44px; height: 44px; font-size: 16px; }
.crm-name { font-size: 14px; font-weight: 500; }
.crm-company { font-size: 12px; color: var(--ink-mute); }
.crm-status { font-size: 11px; padding: 2px 9px; border-radius: 999px; text-transform: capitalize; }
.crm-status.lead { background: var(--signal-soft); color: var(--signal); }
.crm-status.active { background: #e7f4ee; color: #1a7a4f; }
.crm-status.customer { background: #e7f0fb; color: #1a4b72; }
.crm-status.churned { background: var(--paper-3); color: var(--ink-mute); }
.crm-drawer-overlay { position: fixed; inset: 0; z-index: 200; background: rgba(10,10,11,0.32); display: flex; justify-content: flex-end; }
.crm-drawer { width: 460px; max-width: 92vw; height: 100%; background: var(--paper); overflow-y: auto; padding: 22px; box-shadow: -8px 0 32px rgba(0,0,0,0.12); }
.crm-drawer-head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px; }
.crm-edit-name { font-size: 17px; font-weight: 600; border: none; background: none; width: 100%; }
.crm-edit-company { font-size: 13px; color: var(--ink-soft); border: none; background: none; width: 100%; }
.crm-x { color: var(--ink-mute); font-size: 15px; }
.crm-drawer-actions { display: flex; gap: 10px; align-items: center; margin-bottom: 18px; }
.select-sm { padding: 5px 9px; font-size: 12.5px; width: auto; }
.crm-fields { display: grid; grid-template-columns: 84px 1fr; gap: 8px 12px; align-items: center; margin-bottom: 20px; }
.crm-fields label { font-size: 12px; color: var(--ink-soft); }
.crm-section-h { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--ink-mute); margin: 18px 0 10px; }
.crm-call { display: flex; gap: 10px; align-items: center; padding: 7px 0; border-bottom: 1px solid var(--rule-2); font-size: 13px; }
.crm-call-dir { width: 18px; text-align: center; color: var(--ink-soft); }
.crm-call-status { margin-left: auto; font-size: 11px; color: var(--ink-mute); text-transform: capitalize; }
.crm-call-status.bad { color: var(--danger); }
.crm-none { font-size: 13px; padding: 6px 0; }
.crm-note-add { display: flex; gap: 8px; margin-bottom: 12px; }
.crm-note-add textarea { flex: 1; }
.crm-note { padding: 10px 0; border-bottom: 1px solid var(--rule-2); }
.crm-note-meta { display: flex; justify-content: space-between; margin-bottom: 4px; }
.crm-note-kind { font-size: 11px; font-weight: 600; color: var(--signal); }
.crm-note-body { font-size: 13.5px; white-space: pre-wrap; }
.modal { width: 100%; max-width: 420px; margin: auto; background: var(--paper); }
.crm-head-actions { display: flex; gap: 10px; }
.crm-source { font-size: 11px; padding: 2px 8px; border-radius: 4px; background: var(--paper-3); color: var(--ink-soft); }
.imp-modal { max-width: 460px; }
.imp-tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--rule); margin-bottom: 16px; }
.imp-tab { padding: 8px 14px; font-size: 13px; color: var(--ink-soft); border-bottom: 2px solid transparent; margin-bottom: -1px; }
.imp-tab.on { color: var(--signal); border-bottom-color: var(--signal); font-weight: 500; }
.imp-field { margin-bottom: 14px; }
.imp-field label { display: block; font-size: 12px; color: var(--ink-soft); margin-bottom: 5px; }
.imp-hint { display: block; margin-top: 5px; font-size: 11.5px; }
.imp-drop { border: 1.5px dashed var(--rule-2); border-radius: var(--radius); padding: 28px 18px; text-align: center; cursor: pointer; margin-bottom: 14px; transition: border-color 0.15s, background 0.15s; }
.imp-drop.over { border-color: var(--signal); background: var(--signal-soft); }
.imp-drop-hint { font-size: 13px; color: var(--ink-soft); line-height: 1.6; }
.imp-file { font-size: 13.5px; font-weight: 500; }
.imp-progress { padding: 4px 0; }
.imp-prog-top { display: flex; justify-content: space-between; font-size: 13.5px; margin-bottom: 8px; }
.imp-bar { height: 8px; background: var(--paper-3); border-radius: 999px; overflow: hidden; }
.imp-bar-fill { height: 100%; background: var(--signal); border-radius: 999px; transition: width 0.4s ease; }
.imp-prog-note { font-size: 12.5px; margin: 10px 0 14px; line-height: 1.5; }
</style>
