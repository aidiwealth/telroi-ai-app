<template>
  <div>
    <div class="page-head">
      <div>
        <h1 class="page-title">Verification calls</h1>
        <p class="page-sub">Codes sent by voice, whether they arrived, and whether they were used.</p>
      </div>
    </div>

    <div class="filters card card-pad">
      <div class="filter-grid">
        <div class="field mb0">
          <label>Period</label>
          <select v-model="days" class="select" @change="onDaysChange">
            <option :value="1">Today</option>
            <option :value="7">Last 7 days</option>
            <option :value="30">Last 30 days</option>
            <option :value="90">Last 90 days</option>
          </select>
        </div>
      </div>
    </div>

    <!-- The verified share is the one worth watching: a code that is sent but
         never entered usually means it did not arrive, and a raw send count
         hides that entirely. -->
    <div class="otp-stats">
      <div class="otp-stat"><span class="otp-stat-n">{{ summary.total }}</span><span class="otp-stat-l">Sent</span></div>
      <div class="otp-stat"><span class="otp-stat-n">{{ summary.delivered }}</span><span class="otp-stat-l">Delivered</span></div>
      <div class="otp-stat"><span class="otp-stat-n">{{ summary.verified }}</span><span class="otp-stat-l">Verified</span></div>
      <div class="otp-stat"><span class="otp-stat-n">{{ summary.failed }}</span><span class="otp-stat-l">Failed</span></div>
      <div class="otp-stat"><span class="otp-stat-n">{{ money(summary.chargedMinor) }}</span><span class="otp-stat-l">Charged</span></div>
    </div>

    <div class="card">
      <table class="table">
        <thead>
          <tr><th>Number</th><th>Sent</th><th>Status</th><th>Verified</th><th>Attempts</th><th class="ta-r">Cost</th></tr>
        </thead>
        <tbody>
          <tr v-if="loading"><td colspan="6" class="ta-c muted">Loading…</td></tr>
          <tr v-else-if="!items.length"><td colspan="6" class="ta-c muted">No verification calls in this period.</td></tr>
          <tr v-for="i in items" :key="i.id">
            <td class="mono">{{ i.to }}</td>
            <td>{{ when(i.createdAt) }}</td>
            <td><span class="otp-badge" :class="i.status">{{ i.status }}</span></td>
            <td>
              <span v-if="i.clientSupplied" class="muted">your code</span>
              <span v-else>{{ i.verified ? when(i.verifiedAt) : '—' }}</span>
            </td>
            <td>{{ i.attempts }} / {{ i.maxAttempts }}</td>
            <td class="ta-r mono">{{ i.chargedMinor == null ? '—' : money(i.chargedMinor) }}</td>
          </tr>
        </tbody>
      </table>
      <Pagination v-bind="meta" query-key="otp" @change="goPage" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue';
useHead({ title: 'Verification calls — Telroi' });
const api = useApi();

const days = ref(30);
const page = ref(Number(useRoute().query.otp) || 1);
const meta = ref({ page: 1, pages: 1, total: 0, perPage: 50 });

async function goPage(p: number) { page.value = p; await load(); }

// Narrowing the window from thirty days to seven while on page four would land
// somebody on a page that no longer exists, which looks like a bug and isn't
// quite one.
function onDaysChange() { page.value = 1; load(); }
const loading = ref(true);
const items = ref<any[]>([]);
const summary = reactive<any>({ total: 0, delivered: 0, verified: 0, failed: 0, chargedMinor: 0 });
const currency = ref('NGN');

function money(minor: number) {
  const n = (Number(minor) || 0) / 100;
  return currency.value === 'USD' ? `$${n.toFixed(2)}` : `₦${n.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
}
function when(v: string | null) {
  if (!v) return '—';
  return new Date(v).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

async function load() {
  loading.value = true;
  try {
    const r = await api.get<any>('/api/voice/otp', { days: days.value, page: page.value });
    items.value = r.items || [];
    meta.value = { page: r.page || 1, pages: r.pages || 1, total: r.total || 0, perPage: r.perPage || 50 };
    Object.assign(summary, r.summary || {});
    try { const w = await api.get<any>('/api/wallet'); currency.value = w?.currency || 'NGN'; } catch { /* default */ }
  } catch { items.value = []; }
  finally { loading.value = false; }
}
onMounted(load);
</script>

<style scoped>
.otp-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 12px; margin: 16px 0; }
.otp-stat { background: var(--paper); border: 1px solid var(--rule); border-radius: var(--radius); padding: 14px 16px; display: flex; flex-direction: column; gap: 4px; }
.otp-stat-n { font-size: 22px; font-weight: 600; color: var(--ink); font-variant-numeric: tabular-nums; }
.otp-stat-l { font-size: 12px; color: var(--ink-soft); }
.otp-badge { font-size: 11.5px; padding: 2px 8px; border-radius: 999px; background: var(--paper-2); color: var(--ink-soft); text-transform: capitalize; }
.otp-badge.verified { background: rgba(34,139,84,.12); color: #1c7a49; }
.otp-badge.failed { background: rgba(180,45,45,.12); color: #a33; }
.ta-r { text-align: right; }
.ta-c { text-align: center; }
</style>
