<template>
  <div>
    <div class="page-head ov-head">
      <div>
        <h1 class="page-title">Overview</h1>
        <p class="page-sub">What's happening across your voice stack right now.</p>
      </div>
    </div>

    <!-- Stat tiles -->
    <div class="stat-grid">
      <div class="stat">
        <div class="stat-label">Calls today</div>
        <div class="stat-value">{{ pending ? '—' : stats.total }}</div>
        <div class="stat-meta">{{ stats.inbound }} in · {{ stats.outbound }} out</div>
      </div>
      <div class="stat">
        <div class="stat-label">Missed</div>
        <div class="stat-value" :style="stats.missed ? 'color:var(--danger)' : ''">{{ pending ? '—' : stats.missed }}</div>
        <div class="stat-meta">{{ missedPct }}% of inbound</div>
      </div>
      <div class="stat">
        <div class="stat-label">Avg. wait</div>
        <div class="stat-value">{{ pending ? '—' : stats.avgWait }}<span class="unit">s</span></div>
        <div class="stat-meta">Across answered calls</div>
      </div>
      <div class="stat">
        <div class="stat-label">Agents online</div>
        <div class="stat-value">{{ agentsOnline }}<span class="unit">/{{ agentsTotal }}</span></div>
        <div class="stat-meta">Ready to take calls</div>
      </div>
    </div>

    <!-- Call volume trend + quick actions -->
    <div class="ov-mid">
      <div class="card ov-chart">
        <div class="card-head">
          <span class="card-title">Call volume</span>
          <span class="muted ov-chart-sub">Last 14 days</span>
        </div>
        <div class="ov-chart-body">
          <svg v-if="trend.length" class="ov-svg" :viewBox="`0 0 ${chartW} ${chartH}`" preserveAspectRatio="none">
            <defs>
              <linearGradient id="ovFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="var(--signal)" stop-opacity="0.18" />
                <stop offset="100%" stop-color="var(--signal)" stop-opacity="0" />
              </linearGradient>
            </defs>
            <path :d="areaPath" fill="url(#ovFill)" />
            <path :d="linePath" fill="none" stroke="var(--signal)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke" />
            <circle :cx="lastPoint.x" :cy="lastPoint.y" r="3.5" fill="var(--signal)" />
          </svg>
          <div v-else class="ov-chart-empty muted">No call data yet</div>
        </div>
        <div class="ov-chart-foot">
          <span class="muted">{{ trendTotal }} calls over 14 days</span>
          <span class="ov-chart-peak">Peak {{ trendPeak }}/day</span>
        </div>
      </div>

      <div class="ov-quick">
        <NuxtLink to="/wallet" class="ov-q-card">
          <div class="ov-q-icon ov-q-wallet">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3" y="6" width="18" height="13" rx="2.5"/><path d="M3 10h18"/></svg>
          </div>
          <div class="ov-q-text">
            <div class="ov-q-title">Top up wallet</div>
            <div class="ov-q-sub money">{{ bal.sym }}{{ bal.whole }}<span class="cents">{{ bal.cents }}</span> available</div>
          </div>
          <span class="ov-q-arrow">→</span>
        </NuxtLink>

        <NuxtLink to="/developers" class="ov-q-card">
          <div class="ov-q-icon ov-q-key">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="8" cy="15" r="4"/><path d="M10.8 12.2 19 4M16 7l2 2M14 9l1.5 1.5"/></svg>
          </div>
          <div class="ov-q-text">
            <div class="ov-q-title">API keys</div>
            <div class="ov-q-sub muted">{{ keyCount === null ? '—' : keyCount }} active {{ keyCount === 1 ? 'key' : 'keys' }}</div>
          </div>
          <span class="ov-q-arrow">→</span>
        </NuxtLink>
      </div>
    </div>

    <!-- Recent calls -->
    <div class="card recent">
      <div class="card-head">
        <span class="card-title">Recent calls</span>
        <NuxtLink to="/calls" class="card-link">View all →</NuxtLink>
      </div>
      <div v-if="pending" class="recent-loading">
        <div v-for="i in 5" :key="i" class="skeleton skel-row" />
      </div>
      <table v-else-if="recent.length" class="table">
        <thead>
          <tr><th>Type</th><th>Number</th><th>Agent</th><th>Status</th><th>Duration</th><th>When</th></tr>
        </thead>
        <tbody>
          <tr v-for="c in recent" :key="c.uid" class="clickable" @click="selectedCall = c">
            <td><span class="chip" :class="`chip--${c.type === 'in' ? 'in' : 'out'}`">{{ c.type === 'in' ? 'Inbound' : 'Outbound' }}</span></td>
            <td class="mono">{{ c.client }}</td>
            <td>{{ c.user_name || '—' }}</td>
            <td><span class="chip" :class="statusChip(c.status)">{{ c.status }}</span></td>
            <td class="mono">{{ fmtDur(c.duration) }}</td>
            <td class="muted">{{ fmtTime(c.start) }}</td>
          </tr>
        </tbody>
      </table>
      <EmptyState v-else icon="calls" title="No calls yet"
        description="Once calls start flowing through Telroi, they'll appear here." />
    </div>
    <CallDetailDrawer :call="selectedCall" @close="selectedCall = null" @updated="onCallUpdated" @callback="onCallback" />
    <DialerModal v-if="dialer.open" :initial-phone="dialer.phone" :auto-start="dialer.autoStart" @close="dialer.open = false" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, reactive, onMounted, onUnmounted } from 'vue';
import type { TelroiCall, TelroiUser } from '~/server/utils/telroi/client';

useHead({ title: 'Overview — Telroi' });
const api = useApi();
const toast = useToast();

const pending = ref(true);
const calls = ref<TelroiCall[]>([]);
const selectedCall = ref<TelroiCall | null>(null);
function onCallUpdated(c: TelroiCall) {
  const row = calls.value.find((x) => x.uid === c.uid);
  if (row) { row.rating = c.rating; row.note = c.note; }
}
const dialer = reactive({ open: false, phone: '', autoStart: false });
function onCallback(phone: string) {
  dialer.phone = phone; dialer.autoStart = true; dialer.open = true;
}
const agents = ref<TelroiUser[]>([]);
const money = useMoney();
const wallet = ref<any>({ currency: 'USD', balanceMinor: 0 });
const keyCount = ref<number | null>(null);
const trend = ref<{ day: string; count: number }[]>([]);

const bal = computed(() => money.parts(wallet.value.balanceMinor, wallet.value.currency));

// --- Sleek line chart geometry (pure SVG, no library) ---
const chartW = 560, chartH = 150, padY = 16;
const maxVal = computed(() => Math.max(1, ...trend.value.map((d) => d.count)));
const points = computed(() => trend.value.map((d, i) => {
  const x = trend.value.length > 1 ? (i / (trend.value.length - 1)) * chartW : chartW / 2;
  const y = chartH - padY - (d.count / maxVal.value) * (chartH - padY * 2);
  return { x, y };
}));
// Smooth curvy line via Catmull-Rom → cubic Bézier (monotone-ish, no overshoot spikes).
function smoothPath(pts: { x: number; y: number }[]): string {
  if (!pts.length) return '';
  if (pts.length < 3) return pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  let d = `M${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    const t = 0.18; // smoothing tension
    const c1x = p1.x + (p2.x - p0.x) * t;
    const c1y = p1.y + (p2.y - p0.y) * t;
    const c2x = p2.x - (p3.x - p1.x) * t;
    const c2y = p2.y - (p3.y - p1.y) * t;
    d += ` C${c1x.toFixed(1)} ${c1y.toFixed(1)} ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return d;
}
const linePath = computed(() => smoothPath(points.value));
const areaPath = computed(() => {
  if (!points.value.length) return '';
  return `${smoothPath(points.value)} L${chartW} ${chartH} L0 ${chartH} Z`;
});
const lastPoint = computed(() => points.value[points.value.length - 1] || { x: 0, y: 0 });
const trendTotal = computed(() => trend.value.reduce((s, d) => s + d.count, 0));
const trendPeak = computed(() => Math.max(0, ...trend.value.map((d) => d.count)));

const recent = computed(() => calls.value.slice(0, 10));
const agentsOnline = computed(() => agents.value.filter((a) => a.status === 'online').length);
const agentsTotal = computed(() => agents.value.length);

const stats = computed(() => {
  const all = calls.value;
  const inbound = all.filter((c) => c.type === 'in');
  const outbound = all.filter((c) => c.type === 'out');
  const missed = all.filter((c) => c.status === 'missed');
  const answered = all.filter((c) => c.duration > 0);
  const avgWait = answered.length ? Math.round(answered.reduce((s, c) => s + (c.wait || 0), 0) / answered.length) : 0;
  return { total: all.length, inbound: inbound.length, outbound: outbound.length, missed: missed.length, avgWait };
});
const missedPct = computed(() => stats.value.inbound ? Math.round((stats.value.missed / stats.value.inbound) * 100) : 0);

function statusChip(s: string) {
  if (s === 'missed') return 'chip--missed';
  if (s === 'success') return 'chip--ok';
  return 'chip--out';
}
function fmtDur(s: number) {
  if (!s) return '—';
  const m = Math.floor(s / 60), sec = s % 60;
  return m ? `${m}:${String(sec).padStart(2, '0')}` : `${sec}s`;
}
function fmtTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// Mirror the sandbox/live toggle the topbar controls (localStorage + event).
const env = ref<'live' | 'sandbox'>('sandbox');
function syncEnv() {
  if (!import.meta.client) return;
  const saved = localStorage.getItem('telroi_env');
  env.value = saved === 'live' ? 'live' : 'sandbox';
}
function onEnvChange(e: any) { env.value = e.detail === 'live' ? 'live' : 'sandbox'; }

onMounted(async () => {
  syncEnv();
  if (import.meta.client) window.addEventListener('telroi-env-change', onEnvChange);
  try {
    const [cRes, aRes] = await Promise.all([
      api.get<{ calls: TelroiCall[] }>('/api/voice/calls', { period: 'today', limit: 200 }),
      api.get<{ items: TelroiUser[] }>('/api/voice/agents')
    ]);
    calls.value = cRes.calls || [];
    agents.value = aRes.items || [];
  } catch (e: any) {
    toast.err(e.message);
  } finally {
    pending.value = false;
  }

  // Secondary loads (don't block the main view; fail quietly).
  api.get<any>('/api/wallet').then((w) => { wallet.value = w; }).catch(() => {});
  api.get<any[]>('/api/keys').then((k) => { keyCount.value = k.filter((x) => !x.revoked).length; }).catch(() => { keyCount.value = 0; });

  // 14-day call-volume trend from history.
  try {
    const hist = await api.get<{ calls: TelroiCall[] }>('/api/voice/calls', { period: 'month', limit: 1000 });
    const buckets = new Map<string, number>();
    const today = new Date();
    for (let i = 13; i >= 0; i--) {
      const d = new Date(today); d.setDate(d.getDate() - i);
      buckets.set(d.toISOString().slice(0, 10), 0);
    }
    for (const c of hist.calls || []) {
      const key = new Date(c.start).toISOString().slice(0, 10);
      if (buckets.has(key)) buckets.set(key, (buckets.get(key) || 0) + 1);
    }
    trend.value = [...buckets.entries()].map(([day, count]) => ({ day, count }));
  } catch { /* trend stays empty */ }
});

onUnmounted(() => { if (import.meta.client) window.removeEventListener('telroi-env-change', onEnvChange); });
</script>

<style scoped>
.ov-head { display: flex; align-items: flex-start; justify-content: space-between; }
.stat-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 24px; }
.stat-value .unit { font-size: 18px; color: var(--ink-mute); margin-left: 2px; }

.ov-mid { display: grid; grid-template-columns: 1fr 320px; gap: 16px; margin-bottom: 24px; }
.ov-chart { display: flex; flex-direction: column; overflow: hidden; }
.ov-chart-sub { font-size: 12.5px; }
.ov-chart-body { padding: 18px 8px 8px; flex: 1; min-height: 150px; }
.ov-svg { width: 100%; height: 150px; display: block; }
.ov-chart-empty { display: flex; align-items: center; justify-content: center; height: 150px; font-size: 13px; }
.ov-chart-foot { display: flex; align-items: center; justify-content: space-between; padding: 14px 24px; border-top: 1px solid var(--rule-2); font-size: 13px; }
.ov-chart-peak { color: var(--signal); font-weight: 500; }
.ov-quick { display: flex; flex-direction: column; gap: 16px; }
.ov-q-card { display: flex; align-items: center; gap: 14px; padding: 18px 20px; background: var(--paper); border: 1px solid var(--rule); border-radius: var(--radius); transition: border-color 0.14s, transform 0.14s; flex: 1; }
.ov-q-card:hover { border-color: var(--signal-bright); transform: translateY(-1px); }
.ov-q-icon { width: 42px; height: 42px; border-radius: 11px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.ov-q-icon svg { width: 21px; height: 21px; }
.ov-q-wallet { background: var(--signal-soft); color: var(--signal); }
.ov-q-key { background: rgba(0,210,138,0.1); color: #0a8a5c; }
.ov-q-text { flex: 1; min-width: 0; }
.ov-q-title { font-size: 14.5px; font-weight: 500; }
.ov-q-sub { font-size: 13px; color: var(--ink-soft); margin-top: 2px; }
.ov-q-arrow { color: var(--ink-mute); font-size: 16px; }

.recent { overflow: hidden; }
.card-link { font-size: 13px; color: var(--signal); }
.recent-loading { padding: 16px 24px; display: flex; flex-direction: column; gap: 10px; }
.skel-row { height: 20px; width: 100%; }
@media (max-width: 820px) { .stat-grid { grid-template-columns: repeat(2, 1fr); } .ov-mid { grid-template-columns: 1fr; } }
.recent .clickable { cursor: pointer; transition: background 0.1s; }
.recent .clickable:hover { background: var(--paper-2); }
</style>
