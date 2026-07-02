<template>
  <div class="stack">
    <div class="page-head">
      <div>
        <h1 class="page-title">SIP Status</h1>
        <p class="page-sub">Live registration state of every client SIP endpoint across the platform. Use this to diagnose "my phone won't connect" reports — an offline endpoint means no device is currently registered.</p>
      </div>
    </div>
    <div class="metric-grid" v-if="data">
      <div class="metric-card"><span class="metric-num">{{ data.summary.total }}</span><span class="metric-lbl">Registrable endpoints</span></div>
      <div class="metric-card"><span class="metric-num" style="color:#35c07f">{{ data.summary.online }}</span><span class="metric-lbl">Online</span></div>
      <div class="metric-card"><span class="metric-num" style="color:#d9534f">{{ data.summary.offline }}</span><span class="metric-lbl">Offline</span></div>
    </div>
    <div class="card">
      <div class="card-head">
        <span class="card-title">All endpoints</span>
        <button class="btn btn-ghost btn-sm" :disabled="pending" @click="load">{{ pending ? 'Checking…' : 'Refresh' }}</button>
      </div>
      <div v-if="pending" class="loading-pad"><div v-for="i in 4" :key="i" class="skeleton skel-row" /></div>
      <table v-else-if="data && data.endpoints.length" class="table">
        <thead><tr><th>Status</th><th>Client</th><th>Endpoint</th><th>Username</th><th>Type</th><th>Via</th></tr></thead>
        <tbody>
          <tr v-for="e in data.endpoints" :key="e.id">
            <td><span class="reg-dot" :class="regClass(e)" :title="regTitle(e)"></span><span class="reg-label">{{ regLabel(e) }}</span><span v-if="e.rttMs != null" class="reg-rtt">{{ e.rttMs }}ms</span></td>
            <td>{{ e.tenantName }}</td>
            <td>{{ e.label }}</td>
            <td class="mono">{{ e.username || '—' }}</td>
            <td class="muted">{{ e.provider }}<span v-if="e.kind"> · {{ e.kind }}</span></td>
            <td class="mono muted">{{ e.via || '—' }}</td>
          </tr>
        </tbody>
      </table>
      <div v-else class="card-pad"><EmptyState icon="generic" title="No SIP endpoints" description="No client SIP endpoints have been provisioned yet." /></div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useApi } from '~/composables/useApi';
definePageMeta({ layout: 'admin' });
useHead({ title: 'SIP Status — Admin' });
const api = useApi();
const data = ref<any>(null);
const pending = ref(true);
function regClass(e: any) { if (!e.registrable) return 'reg-na'; return e.registered ? 'reg-on' : 'reg-off'; }
function regLabel(e: any) { if (!e.registrable) return 'Trunk'; return e.registered ? 'Registered' : 'Offline'; }
function regTitle(e: any) {
  if (!e.registrable) return 'Carrier trunk — does not register to the PBX directly.';
  if (e.registered) return `Connected${e.via ? ' from ' + e.via : ''}${e.rttMs != null ? ' · ' + e.rttMs + 'ms' : ''}.`;
  return 'No device is currently registered for this endpoint.';
}
async function load() {
  pending.value = true;
  try { data.value = await api.get('/api/admin/sip/status'); }
  catch { /* */ }
  finally { pending.value = false; }
}
onMounted(load);
</script>

<style scoped>
.metric-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 16px; margin-bottom: 20px; }
.metric-card { display: flex; flex-direction: column; gap: 6px; padding: 20px 22px; background: var(--paper); border: 1px solid var(--rule); border-radius: var(--radius); }
.metric-num { font-family: var(--font-display); font-size: 30px; line-height: 1.05; }
.metric-lbl { font-size: 13px; color: var(--ink-soft); }
.reg-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 7px; vertical-align: middle; background: var(--ink-mute); }
.reg-on { background: #35c07f; box-shadow: 0 0 0 3px rgba(53,192,127,0.15); }
.reg-off { background: #d9534f; box-shadow: 0 0 0 3px rgba(217,83,79,0.12); }
.reg-na { background: #6b7280; }
.reg-label { font-size: 13px; vertical-align: middle; }
.reg-rtt { font-size: 11px; color: var(--ink-soft); margin-left: 6px; vertical-align: middle; }
</style>
