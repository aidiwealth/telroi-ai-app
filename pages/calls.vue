<template>
  <div>
    <div class="page-head calls-head">
      <div>
        <h1 class="page-title">Calls</h1>
        <p class="page-sub">Every call across your numbers, agents and departments.</p>
      </div>
      <ExportButton :url="exportUrl" :label="exportLabel" />
    </div>

    <!-- Filters -->
    <div class="filters card card-pad">
      <div class="filter-grid">
        <div class="field mb0">
          <label>Period</label>
          <select v-model="filters.period" class="select" @change="reload">
            <option value="today">Today</option>
            <option value="yesterday">Yesterday</option>
            <option value="week">This week</option>
            <option value="month">This month</option>
          </select>
        </div>
        <div class="field mb0">
          <label>Direction</label>
          <select v-model="filters.type" class="select" @change="reload">
            <option value="">All</option>
            <option value="in">Inbound</option>
            <option value="out">Outbound</option>
          </select>
        </div>
        <div class="field mb0">
          <label>Search number</label>
          <input v-model="filters.client" class="input mono" placeholder="49151…" @keyup.enter="reload" />
        </div>
        <div class="filter-actions">
          <button class="btn btn-ghost btn-sm" @click="reload">Apply</button>
          <button class="btn btn-ghost btn-sm" @click="exportCsv">Export CSV</button>
        </div>
      </div>
    </div>

    <!-- Table -->
    <div class="card calls-table">
      <div v-if="pending" class="loading-pad">
        <div v-for="i in 8" :key="i" class="skeleton skel-row" />
      </div>
      <table v-else-if="filtered.length" class="table">
        <thead>
          <tr><th>Type</th><th>Number</th><th>Agent</th><th>Department</th><th>Status</th><th>Wait</th><th>Duration</th><th>When</th></tr>
        </thead>
        <tbody>
          <tr v-for="c in filtered" :key="c.uid" class="clickable" @click="selected = c">
            <td><span class="chip" :class="c.type === 'in' ? 'chip--in' : 'chip--out'">{{ c.type === 'in' ? 'In' : 'Out' }}</span></td>
            <td class="mono">{{ c.client }}</td>
            <td>{{ c.user_name || '—' }}</td>
            <td class="muted">{{ c.group_name || '—' }}</td>
            <td><span class="chip" :class="statusChip(c.status)">{{ c.status }}</span></td>
            <td class="mono">{{ c.wait ? c.wait + 's' : '—' }}</td>
            <td class="mono">{{ fmtDur(c.duration) }}</td>
            <td class="muted">{{ fmtTime(c.start) }}</td>
          </tr>
        </tbody>
      </table>
      <EmptyState v-else icon="calls" title="No calls found"
        description="Try widening the period or clearing filters — your calls will show up here." />
    </div>

    <!-- Detail drawer (shared component — same on dashboard) -->
    <CallDetailDrawer :call="selected" @close="selected = null" @updated="onCallUpdated" @callback="onCallback" />
    <DialerModal v-if="dialer.open" :initial-phone="dialer.phone" :auto-start="dialer.autoStart" @close="dialer.open = false" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, reactive, onMounted } from 'vue';
import type { TelroiCall } from '~/server/utils/telroi/client';

useHead({ title: 'Calls — Telroi' });
const api = useApi();
const toast = useToast();

const pending = ref(true);
const calls = ref<TelroiCall[]>([]);
const selected = ref<TelroiCall | null>(null);
// The shared CallDetailDrawer handles rating/note/callback + persistence and
// emits 'updated' so we can reflect changes back into the list row.
function onCallUpdated(c: TelroiCall) {
  const row = calls.value.find((x) => x.uid === c.uid);
  if (row) { row.rating = c.rating; row.note = c.note; }
}
// Call-back opens the dialer pre-filled and auto-starts the ringing flow.
const dialer = reactive({ open: false, phone: '', autoStart: false });
function onCallback(phone: string) {
  dialer.phone = phone;
  dialer.autoStart = true;
  dialer.open = true;
}
const filters = reactive({ period: 'week', type: '', client: '' });

// Server-side export honours the active filters, so the CSV matches the view.
const periodLabels: Record<string, string> = { today: 'today', day: '24h', week: '7d', month: '30d', quarter: '90d', all: 'all' };
const exportUrl = computed(() => {
  const p = new URLSearchParams({ period: filters.period });
  if (filters.type) p.set('type', filters.type);
  return `/api/voice/calls/export?${p.toString()}`;
});
const exportLabel = computed(() => `Export (${periodLabels[filters.period] || filters.period})`);

const filtered = computed(() =>
  calls.value.filter((c) => {
    if (filters.type && c.type !== filters.type) return false;
    if (filters.client && !c.client?.includes(filters.client)) return false;
    return true;
  })
);

function statusChip(s: string) {
  const v = (s || '').toLowerCase();
  if (v === 'missed') return 'chip--missed';
  if (v === 'success' || v === 'answered') return 'chip--ok';
  if (v === 'blocked') return 'chip--bad';
  if (v === 'failed') return 'chip--bad';
  return 'chip--out';
}
function fmtDur(s: number) {
  if (!s) return '—';
  const m = Math.floor(s / 60), sec = s % 60;
  return m ? `${m}:${String(sec).padStart(2, '0')}` : `${sec}s`;
}
function fmtTime(iso: string) {
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

async function reload() {
  pending.value = true;
  try {
    const res = await api.get<{ calls: TelroiCall[] }>('/api/voice/calls', { period: filters.period, limit: 500 });
    calls.value = res.calls || [];
  } catch (e: any) { toast.err(e.message); }
  finally { pending.value = false; }
}

function exportCsv() {
  const rows = [['Type', 'Number', 'Agent', 'Department', 'Status', 'Wait', 'Duration', 'When']];
  for (const c of filtered.value) {
    rows.push([c.type, c.client, c.user_name || '', c.group_name || '', c.status, String(c.wait || 0), String(c.duration || 0), c.start]);
  }
  const csv = rows.map((r) => r.map((f) => `"${String(f).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `telroi-calls-${filters.period}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast.ok('Exported');
}

onMounted(reload);
</script>

<style scoped>
.filters { margin-bottom: 20px; }
.filter-grid { display: grid; grid-template-columns: 160px 160px 1fr auto; gap: 16px; align-items: end; }
.field.mb0 { margin-bottom: 0; }
.filter-actions { display: flex; gap: 8px; }
.calls-table { overflow: hidden; }
.loading-pad { padding: 16px 24px; display: flex; flex-direction: column; gap: 10px; }
.skel-row { height: 20px; }

.drawer-overlay { position: fixed; inset: 0; z-index: 150; background: rgba(10,10,11,0.28); display: flex; justify-content: flex-end; }
.drawer { width: 420px; max-width: 92vw; background: var(--paper); height: 100%; padding: 28px; overflow-y: auto; box-shadow: var(--shadow-pop); }
.drawer-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 18px; }
.modal-x { color: var(--ink-mute); font-size: 14px; }
.drawer-num { font-family: var(--font-display); font-size: 28px; letter-spacing: -0.01em; }
.drawer-when { color: var(--ink-soft); font-size: 13.5px; margin-bottom: 24px; }
.drawer-dl { display: flex; flex-direction: column; gap: 0; }
.drawer-dl > div { display: flex; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid var(--rule-2); }
.drawer-dl dt { color: var(--ink-soft); font-size: 13px; }
.drawer-dl dd { font-size: 14px; }
.rating-empty { color: var(--rule); }
.drawer-rec { margin-top: 22px; }
.drawer-sub { font-family: var(--font-mono); font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--ink-soft); margin-bottom: 10px; }
.drawer-audio { width: 100%; }
.drawer-actions { margin-top: 26px; }

.drawer-enter-active, .drawer-leave-active { transition: opacity .2s; }
.drawer-enter-active .drawer, .drawer-leave-active .drawer { transition: transform .25s var(--motion-ease); }
.drawer-enter-from, .drawer-leave-to { opacity: 0; }
.drawer-enter-from .drawer, .drawer-leave-to .drawer { transform: translateX(40px); }

@media (max-width: 820px) { .filter-grid { grid-template-columns: 1fr 1fr; } }
.calls-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.drawer-rate { margin-top: 22px; }
.rate-stars { display: flex; align-items: center; gap: 4px; margin-bottom: 10px; }
.rate-stars.saving { opacity: 0.6; }
.rate-star { font-size: 24px; line-height: 1; color: var(--rule); transition: color 0.1s; }
.rate-star.on { color: var(--warn); }
.rate-star:hover:not(:disabled) { color: var(--warn); }
.rate-clear { margin-left: 10px; font-size: 12px; color: var(--ink-mute); }
.rate-clear:hover { color: var(--ink); }
.rate-note { width: 100%; padding: 9px 11px; border: 1px solid var(--rule); border-radius: var(--radius); font-size: 13.5px; background: var(--paper); color: var(--ink); resize: vertical; margin-bottom: 8px; outline: none; font-family: inherit; }
.rec-download { display: inline-block; margin-top: 8px; font-size: 13px; color: var(--signal); }
.rec-none { font-size: 13px; color: var(--ink-mute); }
</style>
