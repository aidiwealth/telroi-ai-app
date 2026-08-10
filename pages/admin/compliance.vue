<template>
  <div>
    <h1 class="ad-title">Compliance review</h1>
    <p class="ad-sub">Go-live requests. Approving unlocks live mode for that workspace.</p>

    <div class="log-tabs">
      <button class="log-tab" :class="{ active: tab === 'docs' }" @click="tab = 'docs'">Documents</button>
      <button class="log-tab" :class="{ active: tab === 'nin' }" @click="tab = 'nin'">Identity (NIN)</button>
    </div>

    <div v-if="pending" class="ad-loading">Loading…</div>

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

    <EmptyState v-else-if="!subs.length" icon="quality" title="No submissions yet" description="When clients submit verification documents, they'll appear here for review." />
    <div v-else class="ad-list">
      <div v-for="s in subs" :key="s.id" class="ad-sub-card" :class="s.status">
        <div class="ad-sub-top">
          <div>
            <div class="ad-sub-name">{{ s.officialName }}</div>
            <div class="ad-sub-ws">{{ s.workspace || '—' }} · submitted {{ fmt(s.submittedAt) }}</div>
          </div>
          <span class="ad-status" :class="s.status">{{ s.status }}</span>
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
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
definePageMeta({ layout: 'admin' });
useHead({ title: 'Compliance — Telroi Operator' });

const pending = ref(true);
const subs = ref<any[]>([]);
const tab = ref('docs');

// Nigerian workspaces only: NIMC is a Nigerian register, so a Ghanaian client
// listed as "not verified" would be a criticism of something we never asked
// them for.
const ninRows = computed(() => subs.value.filter((r) => (r.country || '').toUpperCase() === 'NG'));
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
onMounted(load);
</script>

<style scoped>
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
