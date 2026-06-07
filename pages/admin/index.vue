<template>
  <div>
    <div class="page-head ov-head">
      <div>
        <h1 class="ad-title">Overview</h1>
        <p class="ad-sub">Everything happening across Telroi, at a glance.</p>
      </div>
      <span class="live-chip"><span class="pulse" /> Live</span>
    </div>

    <!-- Stat tiles -->
    <div class="stat-grid">
      <div class="stat">
        <div class="stat-label">Workspaces</div>
        <div class="stat-value">{{ pending ? '—' : d.workspaces.total }}</div>
        <div class="stat-meta">+{{ d.workspaces?.newThisWeek || 0 }} this week</div>
      </div>
      <div class="stat">
        <div class="stat-label">Calls today</div>
        <div class="stat-value">{{ pending ? '—' : d.callsToday.total }}</div>
        <div class="stat-meta">{{ d.callsToday?.inbound || 0 }} in · {{ d.callsToday?.outbound || 0 }} out</div>
      </div>
      <div class="stat">
        <div class="stat-label">Numbers in service</div>
        <div class="stat-value">{{ pending ? '—' : d.numbers.active }}</div>
        <div class="stat-meta">{{ d.numbers?.available || 0 }} available to sell</div>
      </div>
      <div class="stat">
        <div class="stat-label">KYC pending</div>
        <div class="stat-value" :style="d.pendingKyc ? 'color:var(--warn)' : ''">{{ pending ? '—' : d.pendingKyc }}</div>
        <div class="stat-meta"><NuxtLink to="/admin/compliance" class="inline-link" v-if="d.pendingKyc">Review now →</NuxtLink><span v-else>All clear</span></div>
      </div>
    </div>

    <!-- Call volume trend + plan mix -->
    <div class="ov-mid">
      <div class="card ov-chart">
        <div class="card-head">
          <span class="card-title">Call volume — all clients</span>
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

      <!-- Plan mix -->
      <div class="card ov-plans">
        <div class="card-head"><span class="card-title">Plan mix</span></div>
        <div class="ov-plan-rows">
          <div class="ov-plan-row">
            <span class="ov-plan-name">Growth</span>
            <div class="ov-bar"><div class="ov-bar-fill growth" :style="`width:${pct(d.workspaces?.plans?.growth)}%`" /></div>
            <span class="ov-plan-n">{{ d.workspaces?.plans?.growth || 0 }}</span>
          </div>
          <div class="ov-plan-row">
            <span class="ov-plan-name">Startup</span>
            <div class="ov-bar"><div class="ov-bar-fill" :style="`width:${pct(d.workspaces?.plans?.startup)}%`" /></div>
            <span class="ov-plan-n">{{ d.workspaces?.plans?.startup || 0 }}</span>
          </div>
          <div class="ov-plan-row">
            <span class="ov-plan-name">Custom</span>
            <div class="ov-bar"><div class="ov-bar-fill custom" :style="`width:${pct(d.workspaces?.plans?.custom)}%`" /></div>
            <span class="ov-plan-n">{{ d.workspaces?.plans?.custom || 0 }}</span>
          </div>
          <div class="ov-plan-trial">
            <span class="pulse-dot" /> {{ d.workspaces?.plans?.trialing || 0 }} on active trial
          </div>
        </div>
      </div>
    </div>

    <!-- Money row -->
    <div class="ov-money">
      <div class="card ov-money-card">
        <div class="ov-money-label">Wallet float held</div>
        <div class="ov-money-vals">
          <span v-for="(amt, cur) in d.walletFloat" :key="cur" class="ov-money-val mono">{{ sym(cur) }}{{ fmtMinor(amt) }}<small>{{ cur }}</small></span>
          <span v-if="!hasFloat" class="muted">—</span>
        </div>
      </div>
      <div class="card ov-money-card">
        <div class="ov-money-label">Revenue · last 30 days</div>
        <div class="ov-money-vals">
          <span v-for="(amt, cur) in d.revenue30" :key="cur" class="ov-money-val mono">{{ sym(cur) }}{{ fmtMinor(amt) }}<small>{{ cur }}</small></span>
          <span v-if="!hasRev" class="muted">No payments yet</span>
        </div>
      </div>
    </div>

    <!-- Demographics: country + sector -->
    <div class="ov-demo">
      <div class="card ov-demo-card">
        <div class="card-head"><span class="card-title">Clients by country</span></div>
        <div class="ov-donut-wrap">
          <svg v-if="countrySlices.length" class="ov-donut" viewBox="0 0 120 120">
            <circle cx="60" cy="60" :r="donutR" fill="none" stroke="var(--paper-3)" :stroke-width="donutW" />
            <circle v-for="(s, i) in countrySlices" :key="i"
              cx="60" cy="60" :r="donutR" fill="none" :stroke="s.color" :stroke-width="donutW"
              :stroke-dasharray="`${s.len} ${circ - s.len}`" :stroke-dashoffset="s.offset"
              transform="rotate(-90 60 60)" stroke-linecap="butt" />
            <text x="60" y="56" text-anchor="middle" class="ov-donut-num">{{ d.workspaces.total }}</text>
            <text x="60" y="70" text-anchor="middle" class="ov-donut-cap">clients</text>
          </svg>
          <div v-else class="ov-chart-empty muted">No data yet</div>
          <ul class="ov-legend">
            <li v-for="(s, i) in countrySlices" :key="i">
              <span class="ov-legend-dot" :style="`background:${s.color}`" />
              <span class="ov-legend-label">{{ s.label }}</span>
              <span class="ov-legend-n">{{ s.value }}</span>
            </li>
          </ul>
        </div>
      </div>

      <div class="card ov-demo-card">
        <div class="card-head"><span class="card-title">Clients by sector</span></div>
        <div class="ov-donut-wrap">
          <svg v-if="sectorSlices.length" class="ov-donut" viewBox="0 0 120 120">
            <circle cx="60" cy="60" :r="donutR" fill="none" stroke="var(--paper-3)" :stroke-width="donutW" />
            <circle v-for="(s, i) in sectorSlices" :key="i"
              cx="60" cy="60" :r="donutR" fill="none" :stroke="s.color" :stroke-width="donutW"
              :stroke-dasharray="`${s.len} ${circ - s.len}`" :stroke-dashoffset="s.offset"
              transform="rotate(-90 60 60)" stroke-linecap="butt" />
            <text x="60" y="56" text-anchor="middle" class="ov-donut-num">{{ d.workspaces.total }}</text>
            <text x="60" y="70" text-anchor="middle" class="ov-donut-cap">clients</text>
          </svg>
          <div v-else class="ov-chart-empty muted">No data yet</div>
          <ul class="ov-legend">
            <li v-for="(s, i) in sectorSlices" :key="i">
              <span class="ov-legend-dot" :style="`background:${s.color}`" />
              <span class="ov-legend-label">{{ s.label }}</span>
              <span class="ov-legend-n">{{ s.value }}</span>
            </li>
          </ul>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
definePageMeta({ layout: 'admin' });
useHead({ title: 'Overview — Telroi Operator' });

const pending = ref(true);
const d = ref<any>({ workspaces: { total: 0, plans: {} }, callsToday: {}, numbers: {}, walletFloat: {}, revenue30: {}, pendingKyc: 0, countries: {}, sectors: {} });
const trend = ref<{ day: string; count: number }[]>([]);

const chartW = 560, chartH = 150;

function sym(c: string) { return c === 'NGN' ? '₦' : '$'; }
function fmtMinor(m: number) { return (m / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
const hasFloat = computed(() => Object.keys(d.value.walletFloat || {}).length > 0);
const hasRev = computed(() => Object.keys(d.value.revenue30 || {}).length > 0);

const planTotal = computed(() => {
  const p = d.value.workspaces?.plans || {};
  return Math.max(1, (p.startup || 0) + (p.growth || 0) + (p.custom || 0));
});
function pct(n?: number) { return Math.round(((n || 0) / planTotal.value) * 100); }

// Chart geometry (same approach as the client overview).
const trendMax = computed(() => Math.max(1, ...trend.value.map((t) => t.count)));
const trendTotal = computed(() => trend.value.reduce((s, t) => s + t.count, 0));
const trendPeak = computed(() => Math.max(0, ...trend.value.map((t) => t.count)));
const points = computed(() => trend.value.map((t, i) => ({
  x: trend.value.length > 1 ? (i / (trend.value.length - 1)) * chartW : 0,
  y: chartH - (t.count / trendMax.value) * (chartH - 12) - 6
})));
function smoothPath(pts: { x: number; y: number }[]): string {
  if (!pts.length) return '';
  if (pts.length < 3) return pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  let d = `M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    const t = 0.18;
    const c1x = p1.x + (p2.x - p0.x) * t;
    const c1y = p1.y + (p2.y - p0.y) * t;
    const c2x = p2.x - (p3.x - p1.x) * t;
    const c2y = p2.y - (p3.y - p1.y) * t;
    d += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
  }
  return d;
}
const linePath = computed(() => smoothPath(points.value));
const areaPath = computed(() => points.value.length ? `${linePath.value} L${chartW},${chartH} L0,${chartH} Z` : '');
const lastPoint = computed(() => points.value[points.value.length - 1] || { x: 0, y: 0 });

// Donut charts for country + sector demographics.
const donutR = 46, donutW = 16;
const circ = 2 * Math.PI * donutR;
// Brand-led palette that degrades gracefully across many slices.
const PALETTE = ['#1a4b72', '#4d83b3', '#00d28a', '#b7791f', '#c0392b', '#123857', '#8b8b93', '#5b5b62', '#9bbcd6', '#0a8a5c'];

function buildSlices(dist: Record<string, number>) {
  const entries = Object.entries(dist || {}).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((s, [, n]) => s + n, 0);
  if (!total) return [];
  // Collapse a long tail into "Other" so the chart stays legible.
  let shown = entries;
  if (entries.length > 6) {
    const head = entries.slice(0, 5);
    const tail = entries.slice(5).reduce((s, [, n]) => s + n, 0);
    shown = [...head, ['Other', tail] as [string, number]];
  }
  let acc = 0;
  return shown.map(([label, value], i) => {
    const len = (value / total) * circ;
    const offset = -acc;
    acc += len;
    return { label, value, len, offset, color: PALETTE[i % PALETTE.length] };
  });
}

const countrySlices = computed(() => buildSlices(d.value.countries));
const sectorSlices = computed(() => buildSlices(d.value.sectors));

onMounted(async () => {
  try {
    const res = await $fetch<any>('/api/admin/overview');
    d.value = res;
    trend.value = res.trend || [];
  } catch (e: any) {
    if (e?.statusCode === 401) await navigateTo('/admin/login');
  } finally { pending.value = false; }
});
</script>

<style scoped>
.ov-head { display: flex; align-items: flex-start; justify-content: space-between; }
.ad-title { font-family: var(--font-display); font-size: 30px; color: var(--ink); letter-spacing: -0.02em; }
.ad-sub { color: var(--ink-mute); font-size: 14px; margin-top: 4px; }
.live-chip { display: inline-flex; align-items: center; gap: 7px; font-size: 12px; color: var(--ink-soft); background: var(--paper); border: 1px solid var(--rule); padding: 5px 11px; border-radius: 999px; }
.pulse { width: 7px; height: 7px; border-radius: 50%; background: var(--live); box-shadow: 0 0 0 0 rgba(0,210,138,0.5); animation: pulse 2s infinite; }
@keyframes pulse { 0% { box-shadow: 0 0 0 0 rgba(0,210,138,0.5); } 70% { box-shadow: 0 0 0 6px rgba(0,210,138,0); } 100% { box-shadow: 0 0 0 0 rgba(0,210,138,0); } }

.stat-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin: 24px 0; }
.stat { background: var(--paper); border: 1px solid var(--rule); border-radius: var(--radius-lg); padding: 18px 20px; }
.stat-label { font-size: 12.5px; color: var(--ink-mute); }
.stat-value { font-size: 30px; font-weight: 600; color: var(--ink); letter-spacing: -0.02em; margin: 4px 0 2px; }
.stat-value .unit { font-size: 15px; color: var(--ink-mute); font-weight: 400; }
.stat-meta { font-size: 12px; color: var(--ink-soft); }

.ov-mid { display: grid; grid-template-columns: 1.7fr 1fr; gap: 14px; margin-bottom: 14px; }
.card { background: var(--paper); border: 1px solid var(--rule); border-radius: var(--radius-lg); }
.card-head { display: flex; align-items: center; justify-content: space-between; padding: 16px 20px 0; }
.card-title { font-size: 14px; font-weight: 600; color: var(--ink); }
.ov-chart-sub { font-size: 12px; }
.ov-chart-body { padding: 14px 12px 0; height: 160px; }
.ov-svg { width: 100%; height: 150px; display: block; }
.ov-chart-empty { display: flex; align-items: center; justify-content: center; height: 150px; font-size: 13px; }
.ov-chart-foot { display: flex; justify-content: space-between; padding: 8px 20px 16px; font-size: 12.5px; }
.ov-chart-peak { color: var(--signal); font-weight: 500; }

.ov-plans { padding: 16px 20px 20px; }
.ov-plan-rows { display: flex; flex-direction: column; gap: 14px; margin-top: 18px; }
.ov-plan-row { display: flex; align-items: center; gap: 12px; }
.ov-plan-name { font-size: 13px; color: var(--ink-soft); width: 56px; flex-shrink: 0; }
.ov-bar { flex: 1; height: 8px; background: var(--paper-3); border-radius: 999px; overflow: hidden; }
.ov-bar-fill { height: 100%; background: var(--ink-mute); border-radius: 999px; transition: width 0.4s var(--motion-ease); }
.ov-bar-fill.growth { background: var(--signal); }
.ov-bar-fill.custom { background: var(--signal-bright); }
.ov-plan-n { font-size: 13px; font-weight: 600; color: var(--ink); width: 28px; text-align: right; }
.ov-plan-trial { display: flex; align-items: center; gap: 8px; font-size: 12.5px; color: var(--ink-soft); margin-top: 6px; padding-top: 14px; border-top: 1px solid var(--rule-2); }
.pulse-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--signal); }

.ov-money { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.ov-money-card { padding: 18px 20px; }
.ov-money-label { font-size: 12.5px; color: var(--ink-mute); margin-bottom: 8px; }
.ov-money-vals { display: flex; gap: 18px; flex-wrap: wrap; align-items: baseline; }
.ov-money-val { font-size: 24px; font-weight: 600; color: var(--ink); }
.ov-money-val small { font-size: 12px; color: var(--ink-mute); font-weight: 400; margin-left: 3px; }

.ov-demo { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-top: 14px; }
.ov-demo-card { padding-bottom: 8px; }
.ov-donut-wrap { display: flex; align-items: center; gap: 22px; padding: 18px 20px 16px; }
.ov-donut { width: 140px; height: 140px; flex-shrink: 0; }
.ov-donut-num { font-size: 22px; font-weight: 600; fill: var(--ink); font-family: var(--font-sans); }
.ov-donut-cap { font-size: 8px; fill: var(--ink-mute); text-transform: uppercase; letter-spacing: 0.08em; font-family: var(--font-sans); }
.ov-legend { list-style: none; margin: 0; padding: 0; flex: 1; display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.ov-legend li { display: flex; align-items: center; gap: 9px; font-size: 13px; }
.ov-legend-dot { width: 9px; height: 9px; border-radius: 50%; flex-shrink: 0; }
.ov-legend-label { color: var(--ink-soft); flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ov-legend-n { color: var(--ink); font-weight: 600; }

@media (max-width: 900px) {
  .stat-grid { grid-template-columns: repeat(2, 1fr); }
  .ov-mid, .ov-money, .ov-demo { grid-template-columns: 1fr; }
}
</style>
