<template>
  <div>

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
          <thead><tr><th>Workspace</th><th>Address</th><th>Outcome</th><th>By</th><th>When</th><th></th></tr></thead>
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
              <td class="ad-r">
                <button v-if="r.status === 'approved'" class="btn btn-ghost btn-xs" :disabled="busy === r.id" @click="revoke(r)">Revoke</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-else class="ad-dim">Nothing decided yet.</p>
    </template>

    <!-- Approving grants call origination with no password behind it. A browser
         confirm is too casual for that; this says what it means. -->
    <div v-if="confirming" class="ad-modal-overlay" @click.self="confirming = null">
      <div class="ad-modal">
        <div class="ad-modal-head"><h3>Trust this address?</h3><button class="ad-x" @click="confirming = null">✕</button></div>
        <p class="req-modal-p">
          Anyone sending from <strong class="mono">{{ confirming.ipAddress }}</strong> will be able to place calls billed to
          <strong>{{ confirming.workspace }}</strong>, without a password.
        </p>
        <p class="req-modal-p ad-dim">There is nothing to rotate afterwards — withdrawing access means removing the endpoint, which you can do from this page.</p>
        <button class="btn btn-signal btn-block" :disabled="busy === confirming.id" @click="doApprove">{{ busy === confirming.id ? 'Approving…' : 'Approve' }}</button>
      </div>
    </div>

    <div v-if="revoking" class="ad-modal-overlay" @click.self="revoking = null">
      <div class="ad-modal">
        <div class="ad-modal-head"><h3>Stop trusting this address?</h3><button class="ad-x" @click="revoking = null">✕</button></div>
        <p class="req-modal-p">
          Calls from <strong class="mono">{{ revoking.ipAddress }}</strong> on behalf of <strong>{{ revoking.workspace }}</strong> will be refused immediately.
        </p>
        <p class="req-modal-p ad-dim">There is no password to rotate here, so this is how access ends. They can request it again.</p>
        <button class="btn btn-danger btn-block" :disabled="busy === revoking.id" @click="doRevoke">{{ busy === revoking.id ? 'Revoking…' : 'Stop trusting it' }}</button>
      </div>
    </div>

    <div v-if="declining" class="ad-modal-overlay" @click.self="declining = null">
      <div class="ad-modal">
        <div class="ad-modal-head"><h3>Decline {{ declining.ipAddress }}</h3><button class="ad-x" @click="declining = null">✕</button></div>
        <div class="ad-field">
          <label>Why — the client sees this</label>
          <textarea v-model="declineReason" class="ad-input" rows="3" placeholder="e.g. that address is a dynamic residential IP; send us a static one"></textarea>
        </div>
        <button class="btn btn-signal btn-block" :disabled="busy === declining.id || declineReason.trim().length < 3" @click="doReject">{{ busy === declining.id ? 'Declining…' : 'Decline' }}</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';

const data = ref<any>({ pending: [], decided: [] });
const pending = ref(true);
const busy = ref<string | null>(null);
const toast = useToast();

function fmt(d: string) { return new Date(d).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }

async function load() {
  pending.value = true;
  try { data.value = await $fetch<any>('/api/admin/sip-requests'); }
  catch (e: any) { if (e?.statusCode === 401) await navigateTo('/admin/login'); }
  finally { pending.value = false; }
}

const confirming = ref<any>(null);
const declining = ref<any>(null);
const declineReason = ref('');

function approve(r: any) { confirming.value = r; }
function reject(r: any) { declining.value = r; declineReason.value = ''; }

async function doApprove() {
  const r = confirming.value;
  busy.value = r.id;
  try {
    await $fetch(`/api/admin/sip-requests/${r.id}/approve`, { method: 'POST' });
    toast.ok(`Now trusting ${r.ipAddress}`);
    confirming.value = null;
    await load();
  } catch (e: any) { toast.err(e?.data?.error?.message || 'Could not approve'); }
  finally { busy.value = null; }
}

async function doReject() {
  const r = declining.value;
  busy.value = r.id;
  try {
    await $fetch(`/api/admin/sip-requests/${r.id}/reject`, { method: 'POST', body: { reason: declineReason.value.trim() } });
    toast.ok('Declined — the client sees your reason');
    declining.value = null;
    await load();
  } catch (e: any) { toast.err(e?.data?.error?.message || 'Could not decline'); }
  finally { busy.value = null; }
}

const revoking = ref<any>(null);
function revoke(r: any) { revoking.value = r; }

async function doRevoke() {
  const r = revoking.value;
  busy.value = r.id;
  try {
    await $fetch(`/api/admin/sip-requests/${r.id}`, { method: 'DELETE' });
    toast.ok('Access withdrawn');
    revoking.value = null;
    await load();
  } catch (e: any) { toast.err(e?.data?.error?.message || 'Could not revoke'); }
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
.req-modal-p { font-size: 14px; line-height: 1.5; margin: 0 0 12px; }
</style>
