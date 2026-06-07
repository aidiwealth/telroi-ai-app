<template>
  <div class="lcm">
    <!-- Overview cards -->
    <div class="lcm-cards">
      <div class="card card-pad lcm-card">
        <div class="lcm-card-top"><span class="lcm-ico" style="background:#e7eef4;color:#1a4b72">●</span><span class="lcm-card-l">Satisfaction</span></div>
        <div class="lcm-card-v">{{ m.overview?.satisfaction ?? 0 }}<span class="lcm-unit">%</span></div>
        <div class="lcm-card-s">{{ m.ratedCount || 0 }} ratings</div>
      </div>
      <div class="card card-pad lcm-card">
        <div class="lcm-card-top"><span class="lcm-ico" style="background:#fff4e0;color:#b7791f">★</span><span class="lcm-card-l">Avg CSAT</span></div>
        <div class="lcm-card-v">{{ m.overview?.avgCsat || '—' }}<span class="lcm-unit">/5</span></div>
        <div class="lcm-card-s">across all agents</div>
      </div>
      <div class="card card-pad lcm-card">
        <div class="lcm-card-top"><span class="lcm-ico" style="background:#e7f4ee;color:#1a7a4f">✓</span><span class="lcm-card-l">Response rate</span></div>
        <div class="lcm-card-v">{{ m.overview?.responseRate ?? 0 }}<span class="lcm-unit">%</span></div>
        <div class="lcm-card-s">{{ m.overview?.answered || 0 }} of {{ m.overview?.calls || 0 }} answered</div>
      </div>
      <div class="card card-pad lcm-card">
        <div class="lcm-card-top"><span class="lcm-ico" style="background:#f1efea;color:#5b5b62">⤺</span><span class="lcm-card-l">Missed / failed</span></div>
        <div class="lcm-card-v">{{ (m.overview?.missed || 0) + (m.overview?.failed || 0) }}</div>
        <div class="lcm-card-s">{{ m.overview?.missed || 0 }} missed · {{ m.overview?.failed || 0 }} failed</div>
      </div>
    </div>

    <div class="lcm-grid">
      <!-- CSAT Overview (distribution) -->
      <div class="card card-pad">
        <h3 class="lcm-h">CSAT overview</h3>
        <p class="lcm-sub">How visitors rated their calls.</p>
        <div v-for="n in [5,4,3,2,1]" :key="n" class="lcm-bar-row">
          <span class="lcm-bar-label">{{ n }} ★</span>
          <div class="lcm-bar"><div class="lcm-bar-fill" :style="{ width: distPct(n) + '%' }" /></div>
          <span class="lcm-bar-n">{{ m.distribution?.[n-1] || 0 }}</span>
        </div>
        <p v-if="!m.ratedCount" class="lcm-empty">No ratings yet.</p>
      </div>

      <!-- CSAT Trend -->
      <div class="card card-pad">
        <h3 class="lcm-h">CSAT trend</h3>
        <p class="lcm-sub">Average rating per day, last 14 days.</p>
        <svg v-if="hasTrend" class="lcm-trend" viewBox="0 0 320 120" preserveAspectRatio="none">
          <polyline :points="trendPoints" fill="none" stroke="var(--signal)" stroke-width="2" />
          <line x1="0" y1="119" x2="320" y2="119" stroke="var(--rule)" stroke-width="1" />
        </svg>
        <p v-else class="lcm-empty">Not enough data to chart yet.</p>
        <div class="lcm-trend-axis"><span>{{ m.trend?.[0]?.date?.slice(5) }}</span><span>{{ m.trend?.[m.trend.length-1]?.date?.slice(5) }}</span></div>
      </div>

      <!-- CSAT by Agent -->
      <div class="card card-pad">
        <h3 class="lcm-h">CSAT by agent</h3>
        <p class="lcm-sub">Average rating by who handled the call.</p>
        <div v-for="a in m.byAgent" :key="a.label" class="lcm-agent">
          <span class="lcm-agent-name">{{ a.label }}</span>
          <div class="lcm-agent-bar"><div class="lcm-agent-fill" :style="{ width: (a.avg/5*100) + '%' }" /></div>
          <span class="lcm-agent-v">{{ a.avg }} <span class="lcm-agent-c">({{ a.count }})</span></span>
        </div>
        <p v-if="!m.byAgent?.length" class="lcm-empty">No agent ratings yet.</p>
      </div>

      <!-- Customer Feedback -->
      <div class="card card-pad lcm-feedback">
        <h3 class="lcm-h">Customer feedback</h3>
        <p class="lcm-sub">Recent comments from callers.</p>
        <div class="lcm-fb-list">
          <div v-for="f in m.feedback" :key="f.id" class="lcm-fb">
            <div class="lcm-fb-top">
              <span class="lcm-fb-stars">{{ '★'.repeat(f.score || 0) }}<span class="lcm-fb-dim">{{ '★'.repeat(5 - (f.score || 0)) }}</span></span>
              <span class="lcm-fb-name">{{ f.name }}</span>
              <span class="lcm-fb-when">{{ fmt(f.when) }}</span>
            </div>
            <p v-if="f.comment" class="lcm-fb-cmt">"{{ f.comment }}"</p>
            <div class="lcm-fb-meta">{{ f.handledBy }}<span v-if="f.location"> · {{ f.location }}</span></div>
          </div>
          <p v-if="!m.feedback?.length" class="lcm-empty">No feedback yet.</p>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
const props = defineProps<{ metrics: any }>();
const m = computed(() => props.metrics || {});
function distPct(n: number) { const d = m.value.distribution || []; const total = d.reduce((a: number, b: number) => a + b, 0); return total ? Math.round((d[n-1] / total) * 100) : 0; }
const hasTrend = computed(() => (m.value.trend || []).some((t: any) => t.count > 0));
const trendPoints = computed(() => {
  const t = m.value.trend || []; if (!t.length) return '';
  const w = 320, h = 120, step = w / Math.max(t.length - 1, 1);
  return t.map((d: any, i: number) => `${(i * step).toFixed(1)},${(h - (d.avg / 5) * (h - 10) - 5).toFixed(1)}`).join(' ');
});
function fmt(d: string) { return d ? new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : ''; }
</script>

<style scoped>
.lcm-cards { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin-bottom: 16px; }
@media (max-width: 820px) { .lcm-cards { grid-template-columns: 1fr 1fr; } }
.lcm-card-top { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
.lcm-ico { width: 24px; height: 24px; border-radius: 7px; display: flex; align-items: center; justify-content: center; font-size: 12px; }
.lcm-card-l { font-size: 12px; color: var(--ink-soft); }
.lcm-card-v { font-size: 28px; font-weight: 700; line-height: 1; }
.lcm-unit { font-size: 14px; font-weight: 500; color: var(--ink-mute); margin-left: 2px; }
.lcm-card-s { font-size: 11.5px; color: var(--ink-mute); margin-top: 6px; }
.lcm-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; align-items: start; }
@media (max-width: 820px) { .lcm-grid { grid-template-columns: 1fr; } }
.lcm-h { font-size: 14px; font-weight: 600; margin-bottom: 3px; }
.lcm-sub { font-size: 12.5px; color: var(--ink-soft); margin-bottom: 14px; }
.lcm-bar-row { display: flex; align-items: center; gap: 12px; padding: 5px 0; }
.lcm-bar-label { width: 32px; font-size: 12px; color: var(--ink-soft); }
.lcm-bar { flex: 1; height: 9px; background: var(--paper-3); border-radius: 999px; overflow: hidden; }
.lcm-bar-fill { height: 100%; background: var(--signal); border-radius: 999px; transition: width .4s; }
.lcm-bar-n { width: 28px; text-align: right; font-size: 12px; color: var(--ink-soft); }
.lcm-trend { width: 100%; height: 120px; }
.lcm-trend-axis { display: flex; justify-content: space-between; font-size: 11px; color: var(--ink-mute); margin-top: 6px; }
.lcm-agent { display: flex; align-items: center; gap: 12px; padding: 7px 0; }
.lcm-agent-name { width: 110px; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lcm-agent-bar { flex: 1; height: 9px; background: var(--paper-3); border-radius: 999px; overflow: hidden; }
.lcm-agent-fill { height: 100%; background: #1a7a4f; border-radius: 999px; }
.lcm-agent-v { font-size: 12.5px; font-weight: 600; width: 56px; text-align: right; }
.lcm-agent-c { color: var(--ink-mute); font-weight: 400; }
.lcm-feedback { grid-column: 1 / -1; }
.lcm-fb-list { display: flex; flex-direction: column; gap: 12px; max-height: 360px; overflow-y: auto; }
.lcm-fb { border: 1px solid var(--rule-2); border-radius: var(--radius); padding: 12px; }
.lcm-fb-top { display: flex; align-items: center; gap: 10px; }
.lcm-fb-stars { color: #f5b301; font-size: 13px; letter-spacing: 1px; }
.lcm-fb-dim { color: #ddd; }
.lcm-fb-name { font-size: 13px; font-weight: 500; }
.lcm-fb-when { margin-left: auto; font-size: 11.5px; color: var(--ink-mute); }
.lcm-fb-cmt { font-size: 13px; color: var(--ink); margin: 8px 0 6px; line-height: 1.5; }
.lcm-fb-meta { font-size: 11.5px; color: var(--ink-mute); }
.lcm-empty { font-size: 12.5px; color: var(--ink-mute); padding: 10px 0; }
</style>
