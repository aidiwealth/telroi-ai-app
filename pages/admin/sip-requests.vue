<template>
  <div>
    <div class="ad-head">
      <div>
        <h1 class="ad-title">SIP access requests</h1>
        <p class="ad-sub">Clients asking us to trust an address so their PBX can send without a password. Approving writes an endpoint identified by source IP — there is no secret afterwards to rotate, so withdrawing access means removing it.</p>
      </div>
    </div>

    <div v-if="pending" class="ad-loading">Loading…</div>

    <template v-else>
      <h2 class="ad-title sec-h">Waiting</h2>
      <EmptyState v-if="!data.pending?.length" icon="generic" title="Nothing waiting" description="Requests appear here as clients make them, and in Slack." />
      <div v-else class="set-card ad-table-wrap">
        <table class="ad-data-table">
          <thead><tr><th>Workspace</th><th>Address</th><th>Note</th><th>Asked</th><th></th></tr></thead>
          <tbody>
            <tr v-for="r in data.pending" :key="r.id">
              <td>{{ r.workspace }}<span class="ad-dim"> · {{ r.requestedBy }}</span></td>
              <td class="mono">{{ r.ipAddress }}</td>
              <td class="ad-dim">{{ r.note || '—' }}</td>
              <td class="ad-dim mono">{{ fmt(r.createdAt) }}</td>
              <td class="ad-r req-actions">
                <button class="btn btn-signal btn-xs" :disabled="busy === r.id" @click="approve(r)">Approve</button>
                <button class="btn btn-ghost btn-xs" :disabled="busy === r.id" @click="reject(r)">Decline</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2 class="ad-title sec-h">Decided</h2>
      <div v-if="data.decided?.length" class="set-card ad-table-wrap">
        <table class="ad-data-table">
          <thead><tr><th>Workspace</th><th>Address</th><th>Outcome</th><th>By</th><th>When</th></tr></thead>
          <tbody>
            <tr v-for="r in data.decided" :key="r.id">
              <td>{{ r.workspace }}</td>
              <td class="mono">{{ r.ipAddress }}</td>
              <td>
                <span class="req-badge" :class="r.status">{{ r.status }}</span>
                <span v-if="r.rejectReason" class="ad-dim"> — {{ r.rejectReason }}</span>
              </td>
              <td class="ad-dim">{{ r.decidedBy || '—' }}</td>
              <td class="ad-dim mono">{{ r.decidedAt ? fmt(r.decidedAt) : '—' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-else class="ad-dim">Nothing decided yet.</p>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
definePageMeta({ layout: 'admin' });
useHead({ title: 'SIP access requests — Telroi' });

const data = ref<any>({ pending: [], decided: [] });
const pending = ref(true);
const busy = ref<string | null>(null);

function fmt(d: string) { return new Date(d).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }

async function load() {
  pending.value = true;
  try { data.value = await $fetch<any>('/api/admin/sip-requests'); }
  catch (e: any) { if (e?.statusCode === 401) await navigateTo('/admin/login'); }
  finally { pending.value = false; }
}

async function approve(r: any) {
  if (!confirm(`Trust ${r.ipAddress} for ${r.workspace}? Anyone at that address will be able to place calls billed to them, with no password.`)) return;
  busy.value = r.id;
  try { await $fetch(`/api/admin/sip-requests/${r.id}/approve`, { method: 'POST' }); await load(); }
  catch (e: any) { alert(e?.data?.error?.message || 'Could not approve'); }
  finally { busy.value = null; }
}

async function reject(r: any) {
  const reason = prompt(`Why are you declining ${r.ipAddress}? The client sees this.`);
  if (!reason) return;
  busy.value = r.id;
  try { await $fetch(`/api/admin/sip-requests/${r.id}/reject`, { method: 'POST', body: { reason } }); await load(); }
  catch (e: any) { alert(e?.data?.error?.message || 'Could not decline'); }
  finally { busy.value = null; }
}

onMounted(load);
</script>

<style scoped>
.sec-h { font-size: 18px; margin: 28px 0 10px; }
.req-actions { display: flex; gap: 8px; justify-content: flex-end; }
.req-badge { font-size: 11.5px; padding: 2px 8px; border-radius: 999px; background: var(--paper-2); color: var(--ink-soft); text-transform: capitalize; }
.req-badge.approved { background: rgba(34,139,84,.12); color: #1c7a49; }
.req-badge.rejected { background: rgba(180,45,45,.12); color: #a33; }
</style>
