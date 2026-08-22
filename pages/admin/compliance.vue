<template>
  <div>
    <h1 class="ad-title">Compliance review</h1>
    <p class="ad-sub">Go-live requests. Approving unlocks live mode for that workspace.</p>

    <div class="log-tabs">
      <button class="log-tab" :class="{ active: tab === 'docs' }" @click="tab = 'docs'">Documents</button>
      <button class="log-tab" :class="{ active: tab === 'nin' }" @click="tab = 'nin'">Identity (NIN)</button>
      <button class="log-tab" :class="{ active: tab === 'forms' }" @click="tab = 'forms'">Forms we issue</button>
      <button class="log-tab" :class="{ active: tab === 'indemnity' }" @click="tab = 'indemnity'; loadAcceptances()">Indemnities</button>
    </div>

    <!-- Blank forms we hand out, as distinct from the documents clients return.
         Uploaded here rather than shipped with the code: a regulator's form
         changes and a deploy is the wrong thing to need when it does. -->
    <template v-if="tab === 'indemnity'">
      <!-- Who accepted what, and on whose authority. A carrier asking about a
           number wants both, and the wording they saw — which is why the version
           travels with the row and the text is one click away. -->
      <div class="ind-filters">
        <input v-model="accQ" class="ad-ctl" placeholder="Number, email or client…" @keyup.enter="loadAcceptances" />
        <select v-model="accCat" class="ad-ctl" @change="loadAcceptances">
          <option value="">All categories</option>
          <option value="authentication">Authentication</option>
          <option value="financial">Financial services</option>
          <option value="health">Health &amp; sensitive data</option>
          <option value="emergency">Emergency &amp; welfare</option>
          <option value="government">Government &amp; public sector</option>
          <option value="outbound">Scaled outbound</option>
        </select>
        <button class="btn btn-ghost btn-sm" @click="loadAcceptances">Search</button>
      </div>

      <div v-if="acceptances.length" class="set-card ad-table-wrap">
        <table class="ad-data-table">
        <thead><tr>
          <th>Client</th><th>Number</th><th>Declared for</th><th>Accepted by</th><th>Version</th><th>When</th><th></th>
        </tr></thead>
        <tbody>
          <tr v-for="a in acceptances" :key="a.id">
            <td>{{ a.tenantName }}</td>
            <td class="mono">{{ a.telnum || '—' }}</td>
            <td>{{ (a.categories || []).join(', ') }}</td>
            <td>{{ a.userEmail }}<span v-if="a.userRole" class="muted"> ({{ a.userRole }})</span></td>
            <td class="mono">{{ a.docVersion }}</td>
            <td>{{ new Date(a.acceptedAt).toLocaleString() }}</td>
            <td><button class="btn btn-ghost btn-sm" @click="viewAcceptance(a)">View</button></td>
          </tr>
        </tbody>
        </table>
      </div>
      <EmptyState v-else icon="quality" title="No indemnities accepted yet"
        description="When a client buys a number for a sensitive use, their acceptance appears here." />
    </template>

    <template v-else-if="tab === 'forms'">
      <div class="set-card card-pad fm-upload">
        <h3 class="ad-panel-h">Upload a form</h3>
        <!-- The same drop zone clients see in the go-live modal, rather than a
             raw file input beside three text boxes. -->
        <label class="fm-drop" :class="{ filled: formFile, over: dragOver }"
               @dragover.prevent="dragOver = true" @dragleave="dragOver = false" @drop.prevent="onFormDrop">
          <input type="file" class="fm-file-input" accept=".pdf,.doc,.docx,.png,.jpg,.jpeg" @change="onFormFile" />
          <span v-if="!formFile" class="fm-drop-text">Drop a file here, or click to choose — PDF, Word, PNG or JPG</span>
          <span v-else class="fm-drop-file">📄 {{ formFile.name }} · {{ Math.round(formFile.size / 1024) }}KB</span>
        </label>

        <div class="fm-grid">
          <label class="fm-field"><span>Reference</span>
            <input v-model="formUp.slug" class="ad-ctl mono" placeholder="ncc_undertaking" />
          </label>
          <label class="fm-field"><span>Title clients see</span>
            <input v-model="formUp.title" class="ad-ctl" placeholder="NCC undertaking" />
          </label>
          <label class="fm-field"><span>Shown to</span>
            <select v-model="formUp.country" class="ad-ctl">
              <option value="">Everyone</option>
              <option value="nigeria">Nigerian clients only</option>
            </select>
          </label>
        </div>
        <label class="fm-field fm-desc"><span>What they must do with it</span>
          <input v-model="formUp.description" class="ad-ctl" placeholder="Print, sign on your company letterhead and upload the signed copy." />
        </label>
        <button class="btn btn-signal btn-sm" :disabled="formBusy || !formFile || !formUp.slug || !formUp.title" @click="uploadForm">
          {{ formBusy ? 'Uploading…' : 'Upload' }}
        </button>
      </div>

      <EmptyState v-if="!forms.length" icon="generic" title="No forms yet" description="Upload the NCC undertaking so Nigerian clients can download and sign it." />
      <div v-else class="set-card ad-table-wrap">
        <table class="ad-data-table">
          <thead><tr><th>Title</th><th>Reference</th><th>File</th><th>Shown to</th><th>Updated</th><th></th></tr></thead>
          <tbody>
            <tr v-for="d in forms" :key="d.id">
              <td>{{ d.title }}<div v-if="d.description" class="ad-dim">{{ d.description }}</div></td>
              <td class="mono">{{ d.slug }}</td>
              <td class="ad-dim">{{ d.filename }}<span v-if="d.sizeBytes" class="ad-dim"> · {{ Math.round(d.sizeBytes / 1024) }}KB</span></td>
              <td class="ad-dim">{{ d.country === 'nigeria' ? 'Nigeria' : 'Everyone' }}</td>
              <td class="ad-dim mono">{{ fmt(d.updatedAt) }}</td>
              <td class="ad-r"><button class="btn btn-ghost btn-xs" @click="removeForm(d)">Remove</button></td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>

    <div v-if="pending && tab !== 'forms'" class="ad-loading">Loading…</div>

    <!-- Identity. Who has verified, who hasn't, and who is struggling — the
         attempt count is the useful column, since somebody on their fourth try
         is worth a call before they give up. -->
    <template v-else-if="tab === 'nin'">
      <EmptyState v-if="!ninRows.length" icon="quality" title="Nothing to show" description="Nigerian workspaces appear here once they begin verification." />
      <div v-else class="set-card ad-table-wrap">
        <table class="ad-data-table">
          <thead><tr><th>Workspace</th><th>Director</th><th>Verified</th><th>Attempts</th></tr></thead>
          <tbody>
            <tr v-for="r in ninRows" :key="r.id">
              <td>{{ r.workspace || r.officialName }}</td>
              <td>{{ r.directorName || '—' }}<span v-if="r.ninName && r.ninName !== r.directorName" class="ad-dim"> · {{ r.ninName }}</span></td>
              <td>
                <span v-if="r.ninVerifiedAt" class="ad-status approved">verified {{ fmt(r.ninVerifiedAt) }}</span>
                <span v-else class="ad-status pending">not verified</span>
              </td>
              <td class="ad-dim">{{ r.ninAttempts || 0 }}<span v-if="r.ninLastAttemptAt" class="ad-dim"> · last {{ fmt(r.ninLastAttemptAt) }}</span></td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>

    <!-- The tab has to be named. Without it this is simply the else of a chain
         beginning at the loading line, so the Forms tab fell through to the
         submissions list and showed both at once. -->
    <EmptyState v-else-if="tab === 'docs' && !subs.length" icon="quality" title="No submissions yet" description="When clients submit verification documents, they'll appear here for review." />
    <div v-else-if="tab === 'docs'" class="ad-list">
      <div v-for="s in subs" :key="s.id" class="ad-sub-card" :class="s.status">
        <div class="ad-sub-top">
          <div>
            <div class="ad-sub-name">{{ s.officialName }}</div>
            <div class="ad-sub-ws">{{ s.workspace || '—' }} · submitted {{ fmt(s.submittedAt) }}</div>
          </div>
          <span class="ad-status" :class="s.status">{{ s.status }}</span>
        </div>
        <!-- What they say the line is for. The licences prove who they are;
             this is the part that says what they intend to do, which is what an
             operator is actually judging. -->
        <div v-if="s.useCase || s.callAudience" class="ad-sub-use">
          <div v-if="s.useCase"><span class="ad-doc-label">Use</span>{{ s.useCase }}</div>
          <div v-if="s.callAudience"><span class="ad-doc-label">Calling</span>{{ s.callAudience }}</div>
        </div>

        <div class="ad-sub-docs">
          <div><span class="ad-doc-label">Business license</span>
            <a v-if="s.hasBusinessDoc" :href="`/api/admin/compliance/${s.tenantId}/document?doc=business`" target="_blank" rel="noopener" class="ad-doc-link">{{ s.businessLicenseName || 'View document' }} →</a>
            <span v-else>—</span>
          </div>
          <div><span class="ad-doc-label">Regulatory license</span>
            <a v-if="s.hasRegulatoryDoc" :href="`/api/admin/compliance/${s.tenantId}/document?doc=regulatory`" target="_blank" rel="noopener" class="ad-doc-link">{{ s.regulatoryLicenseName || 'View document' }} →</a>
            <span v-else>—</span>
          </div>
        </div>
        <div v-if="s.notes" class="ad-sub-notes">Note: {{ s.notes }}</div>
        <div v-if="s.status === 'pending'" class="ad-sub-actions">
          <input v-model="notes[s.id]" class="ad-input ad-note-input" placeholder="Optional note to the client" />
          <button class="btn btn-ghost btn-sm ad-reject" :disabled="busy === s.id" @click="decide(s.id, 'rejected')">Reject</button>
          <button class="btn btn-signal btn-sm" :disabled="busy === s.id" @click="decide(s.id, 'approved')">Approve</button>
        </div>
      </div>
    </div>
  </div>

    <!-- The wording an acceptance points at, not the current wording. Two
         versions on, those differ, and the register exists to answer which one
         somebody actually saw. -->
    <div v-if="viewing" class="modal-overlay" @click.self="viewing = null">
      <div class="modal acc-modal">
        <button class="modal-x" @click="viewing = null">&times;</button>
        <h3 class="acc-h">{{ viewing.title }}</h3>
        <p class="acc-sub muted">Version {{ viewing.docVersion }}</p>

        <div class="acc-facts">
          <div><span>Client</span><strong>{{ viewing.tenantName }}</strong></div>
          <div><span>Number</span><strong class="mono">{{ viewing.telnum || '—' }}</strong></div>
          <div><span>Declared for</span><strong>{{ (viewing.categories || []).join(', ') }}</strong></div>
          <div><span>Accepted by</span><strong>{{ viewing.userEmail }}<template v-if="viewing.userRole"> ({{ viewing.userRole }})</template></strong></div>
          <div><span>When</span><strong>{{ new Date(viewing.acceptedAt).toLocaleString() }}</strong></div>
          <div><span>From</span><strong class="mono">{{ viewing.ip || '—' }}</strong></div>
        </div>

        <div class="acc-body">{{ viewing.body }}</div>
      </div>
    </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
definePageMeta({ layout: 'admin' });
useHead({ title: 'Compliance — Telroi Operator' });

const pending = ref(true);
const subs = ref<any[]>([]);
const tab = ref('docs');

// The register. Loaded when the tab is opened rather than on mount — most
// visits here are to review a submission, and this can grow long.
const acceptances = ref<any[]>([]);
const accQ = ref('');
const accCat = ref('');
const viewing = ref<any>(null);

async function loadAcceptances() {
  try {
    const r = await $fetch<any>('/api/admin/legal/acceptances', {
      query: { q: accQ.value || undefined, category: accCat.value || undefined }
    });
    acceptances.value = r.acceptances || [];
  } catch { acceptances.value = []; }
}

/** The wording they actually saw, fetched by version rather than by slug — the
 *  current text is not evidence of what somebody accepted two versions ago. */
async function viewAcceptance(a: any) {
  try {
    const r = await $fetch<any>(`/api/admin/legal/document/${a.documentId}`);
    viewing.value = { ...a, body: r.document.body, title: r.document.title };
  } catch { alert('Could not load that version'); }
}

const forms = ref<any[]>([]);
const formFile = ref<File | null>(null);
const formBusy = ref(false);
const formUp = ref({ slug: '', title: '', description: '', country: '' });

const dragOver = ref(false);
function onFormFile(e: Event) { formFile.value = (e.target as HTMLInputElement).files?.[0] || null; }
function onFormDrop(e: DragEvent) {
  dragOver.value = false;
  formFile.value = e.dataTransfer?.files?.[0] || null;
}

async function loadForms() {
  try { forms.value = (await $fetch<any>('/api/admin/documents')).documents || []; }
  catch { /* the submissions above still matter */ }
}

async function uploadForm() {
  formBusy.value = true;
  try {
    const fd = new FormData();
    fd.append('file', formFile.value as File);
    fd.append('slug', formUp.value.slug.trim());
    fd.append('title', formUp.value.title.trim());
    fd.append('description', formUp.value.description.trim());
    fd.append('country', formUp.value.country);
    await $fetch('/api/admin/documents', { method: 'POST', body: fd });
    formUp.value = { slug: '', title: '', description: '', country: '' };
    formFile.value = null;
    await loadForms();
  } catch (e: any) { alert(e?.data?.error?.message || 'Upload failed'); }
  finally { formBusy.value = false; }
}

async function removeForm(d: any) {
  // A client part-way through signing this would find the download gone, so
  // worth a moment's thought rather than a single click.
  if (!confirm(`Stop offering "${d.title}"? Anyone part-way through signing it will lose the download.`)) return;
  try { await $fetch(`/api/admin/documents/${d.slug}`, { method: 'DELETE' }); await loadForms(); }
  catch (e: any) { alert(e?.data?.error?.message || 'Could not remove'); }
}

// Nigerian workspaces only: NIMC is a Nigerian register, so a Ghanaian client
// listed as "not verified" would be a criticism of something we never asked
// them for.
const ninRows = computed(() => subs.value.filter((r) => (r.country || '').toLowerCase() === 'nigeria'));
const notes = ref<Record<string, string>>({});
const busy = ref<string | null>(null);

function fmt(d: string) { return new Date(d).toLocaleDateString(); }

async function load() {
  pending.value = true;
  try { subs.value = (await $fetch<any>('/api/admin/compliance')).submissions; }
  catch { await navigateTo('/admin/login'); }
  finally { pending.value = false; }
}
async function decide(id: string, decision: string) {
  busy.value = id;
  try {
    await $fetch(`/api/admin/compliance/${id}`, { method: 'POST', body: { decision, notes: notes.value[id] || undefined } });
    await load();
  } catch (e: any) { alert(e?.data?.error?.message || 'Failed'); }
  finally { busy.value = null; }
}
onMounted(() => { load(); loadForms(); });
</script>

<style scoped>
.acc-modal { max-width: 780px; width: 94vw; padding: 28px 32px 24px; max-height: 88vh; overflow-y: auto; }
.acc-h { font-size: 19px; font-weight: 600; margin: 0 0 2px; }
.acc-sub { font-size: 12.5px; margin: 0 0 18px; }
.acc-facts { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px 24px; margin-bottom: 20px;
  padding: 16px 18px; border: 1px solid var(--rule); border-radius: var(--radius); background: var(--paper-2); }
.acc-facts > div { display: flex; flex-direction: column; gap: 2px; }
.acc-facts span { font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: var(--ink-mute); }
.acc-facts strong { font-size: 13px; font-weight: 600; color: var(--ink); }
.acc-body { white-space: pre-wrap; font-size: 12.5px; line-height: 1.6; color: var(--ink-soft);
  border: 1px solid var(--rule); border-radius: var(--radius); padding: 20px; max-height: 40vh; overflow-y: auto; }
/* ad-ctl is defined in the clients page's scoped block, so it never reached
   here — these filters and the note input above were both unstyled. Defined
   locally rather than reaching for a class this page does not have. */
.ind-filters { display: flex; gap: 10px; margin-bottom: 18px; align-items: center; flex-wrap: wrap; }
.ind-filters .ad-ctl { height: 36px; padding: 0 12px; font-size: 13px; color: var(--ink);
  background: var(--paper); border: 1px solid var(--rule); border-radius: var(--radius);
  outline: none; transition: border-color .12s; max-width: 260px; }
.ind-filters .ad-ctl:focus { border-color: var(--signal); }
.ind-filters .ad-ctl:first-child { flex: 1; min-width: 220px; max-width: 340px; }
.ind-filters select.ad-ctl { cursor: pointer; }
.ad-sub-use { display: flex; flex-direction: column; gap: 6px; margin: 12px 0; font-size: 13px; line-height: 1.55; }
.ad-sub-use .ad-doc-label { display: block; }
.fm-upload { margin-bottom: 18px; }
.fm-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; margin-bottom: 16px; }
/* Label above input. ad-ovr, borrowed from elsewhere, is defined nowhere at
   all — so the labels and controls ran together with no styling whatever. */
.fm-field { display: flex; flex-direction: column; gap: 6px; }
.fm-field > span { font-size: 12px; color: var(--ink-soft); font-weight: 500; }
.fm-field .ad-ctl { width: 100%; padding: 9px 12px; border: 1px solid var(--rule); border-radius: var(--radius); font-size: 14px; background: var(--paper); color: var(--ink); }
.fm-field .ad-ctl:focus { outline: none; border-color: var(--signal); box-shadow: 0 0 0 3px var(--signal-soft); }
/* Matching the modal's drop zone rather than inventing a second one. */
.fm-drop { display: block; border: 1.5px dashed var(--rule); border-radius: var(--radius); padding: 20px; text-align: center; cursor: pointer; margin-bottom: 16px; transition: border-color 0.14s, background 0.14s; }
.fm-drop:hover, .fm-drop.over { border-color: var(--signal-bright); background: var(--signal-soft); }
.fm-drop.filled { border-style: solid; border-color: var(--signal); background: var(--signal-soft); }
.fm-file-input { display: none; }
.fm-drop-text { font-size: 12.5px; color: var(--ink-mute); }
.fm-drop-file { font-size: 13px; color: var(--signal-2); font-weight: 500; word-break: break-all; }
.fm-desc { margin-bottom: 16px; }
.fm-upload .ad-none { margin: 0 0 14px; max-width: 68ch; line-height: 1.6; }
.ad-title { font-family: var(--font-display); font-size: 30px; color: var(--ink); letter-spacing: -0.02em; }
.ad-sub { color: var(--ink-mute); font-size: 14px; margin: 4px 0 28px; }
.ad-loading, .ad-empty { color: var(--ink-mute); padding: 40px 0; }
.ad-list { display: flex; flex-direction: column; gap: 12px; }
.ad-sub-card { background: var(--paper); border: 1px solid var(--rule); border-radius: var(--radius-lg); padding: 20px; }
.ad-sub-card.pending { border-color: rgba(183,121,31,0.3); }
.ad-sub-top { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 14px; }
.ad-sub-name { font-size: 16px; font-weight: 600; color: var(--ink); }
.ad-sub-ws { font-size: 12.5px; color: var(--ink-mute); margin-top: 2px; }
.ad-status { font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.05em; padding: 3px 10px; border-radius: 999px; font-weight: 500; background: var(--paper-2); color: var(--ink-soft); }
.ad-status.approved { background: rgba(0,210,138,0.14); color: var(--live); }
.ad-status.rejected { background: rgba(192,57,43,0.18); color: #e0664e; }
.ad-status.pending { background: rgba(183,121,31,0.18); color: #e0a64e; }
.ad-sub-docs { display: flex; gap: 32px; font-size: 13px; color: var(--ink); margin-bottom: 8px; }
.ad-doc-label { display: block; font-size: 11px; color: var(--ink-mute); margin-bottom: 2px; }
.ad-sub-notes { font-size: 12.5px; color: var(--ink-soft); margin-bottom: 12px; }
.ad-sub-actions { display: flex; gap: 8px; align-items: center; margin-top: 14px; }
.ad-note-input { flex: 1; padding: 8px 12px; border: 1px solid var(--rule); border-radius: var(--radius); font-size: 13px; }
.ad-reject { color: #e0664e; border-color: rgba(192,57,43,0.3); }
.ad-doc-link { color: var(--signal); text-decoration: underline; text-underline-offset: 2px; }
</style>
