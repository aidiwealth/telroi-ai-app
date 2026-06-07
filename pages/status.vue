<template>
  <div class="st">
    <!-- Top bar -->
    <header class="st-top">
      <div class="st-top-inner">
        <a class="st-logo" :href="appBase || '/'">
          <img src="https://pub-f138f42d66b748108ebf7432c7314665.r2.dev/telroi-ll.png" alt="Telroi" />
          <span class="st-logo-tag">Status</span>
        </a>
        <a class="st-top-btn" :href="appBase || '/'">Telroi ↗</a>
      </div>
    </header>

    <main class="st-main">
      <!-- Overall banner -->
      <section class="st-hero" :class="`ov-${overall}`">
        <div class="st-hero-dot"><span /></div>
        <div>
          <h1 class="st-hero-title">{{ overallTitle }}</h1>
          <p class="st-hero-sub">{{ overallSub }}</p>
        </div>
        <div class="st-hero-time">{{ nowLabel }}</div>
      </section>

      <!-- Active incident callout -->
      <section v-if="activeIncident" class="st-active" :class="`im-${activeIncident.impact}`">
        <div class="st-active-head">
          <span class="st-active-badge">{{ statusLabel(activeIncident.status) }}</span>
          <h3>{{ activeIncident.title }}</h3>
        </div>
        <p v-if="activeIncident.body" class="st-active-body">{{ activeIncident.body }}</p>
        <div class="st-active-meta">{{ fmt(activeIncident.startedAt) }}</div>
      </section>

      <!-- Components -->
      <section class="st-card">
        <div class="st-card-head"><h2>Components</h2><span class="st-legend"><span class="st-pip operational" /> All systems</span></div>
        <div class="st-comp" v-for="c in components" :key="c.key">
          <div class="st-comp-main">
            <div class="st-comp-name">{{ c.title }}<span v-if="c.description" class="st-comp-desc">{{ c.description }}</span></div>
            <div class="st-comp-status" :class="c.status"><span class="st-pip" :class="c.status" />{{ compLabel(c.status, c.monitored) }}</div>
          </div>
          <!-- 90-day uptime bar (from recorded checks) -->
          <div class="st-bars" :title="c.uptime90 != null ? `${(c.uptime90/100).toFixed(2)}% uptime (90 days)` : 'Not yet monitored'">
            <span v-for="(seg, i) in barSegments(c)" :key="i" class="st-bar" :class="seg" />
          </div>
          <div class="st-bars-foot">
            <span>90 days ago</span>
            <span class="st-uptime">{{ c.uptime90 != null ? (c.uptime90/100).toFixed(2) + '% uptime' : 'Awaiting data' }}</span>
            <span>Today</span>
          </div>
        </div>
      </section>

      <!-- Incident history -->
      <section class="st-card">
        <div class="st-card-head"><h2>Past incidents</h2></div>
        <div v-if="!pastIncidents.length" class="st-empty">No incidents reported in the last 90 days. ✦</div>
        <div v-for="inc in pastIncidents" :key="inc.id" class="st-inc">
          <div class="st-inc-row">
            <span class="st-inc-impact" :class="`im-${inc.impact}`" />
            <div class="st-inc-body">
              <div class="st-inc-title">{{ inc.title }}</div>
              <div v-if="inc.body" class="st-inc-text">{{ inc.body }}</div>
              <div class="st-inc-meta">
                <span class="st-inc-state" :class="inc.status">{{ statusLabel(inc.status) }}</span>
                <span>{{ fmt(inc.startedAt) }}<template v-if="inc.resolvedAt"> → {{ fmt(inc.resolvedAt) }}</template></span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <footer class="st-foot">
        <span>© {{ year }} Telroi</span>
        <a :href="`${appBase}/api/docs`">API docs</a>
      </footer>
    </main>
    <button v-show="showTop" class="st-totop" aria-label="Back to top" @click="scrollTop">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>
    </button>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
definePageMeta({ layout: false });
useHead({ title: 'Telroi Status', meta: [{ name: 'description', content: 'Live operational status of Telroi voice, OTP, speech and API services.' }] });

const appBase = ref('');
const showTop = ref(false);
function scrollTop() { window.scrollTo({ top: 0, behavior: 'smooth' }); }
const components = ref<any[]>([]);
const incidents = ref<any[]>([]);
const overall = ref('operational');
const year = new Date().getFullYear();
const nowLabel = ref('');

const activeIncident = computed(() => incidents.value.find((i) => i.status !== 'resolved'));
const pastIncidents = computed(() => incidents.value.filter((i) => i.status === 'resolved'));

const overallTitle = computed(() => ({
  operational: 'All systems operational',
  maintenance: 'Scheduled maintenance',
  degraded: 'Degraded performance',
  partial_outage: 'Partial outage',
  major_outage: 'Major outage',
  unknown: 'Monitoring starting up'
} as Record<string, string>)[overall.value] || 'All systems operational');
const overallSub = computed(() => overall.value === 'operational'
  ? 'Everything is running smoothly.'
  : 'We are aware of an issue and working on it.');

function compLabel(s: string, monitored = true) {
  if (s === 'unknown' || (!monitored && s === 'operational')) return 'Not monitored';
  return ({ operational: 'Operational', degraded: 'Degraded', partial_outage: 'Partial outage', major_outage: 'Major outage', maintenance: 'Maintenance', unknown: 'Not monitored' } as Record<string, string>)[s] || s;
}
function statusLabel(s: string) { return ({ investigating: 'Investigating', identified: 'Identified', monitoring: 'Monitoring', resolved: 'Resolved' } as Record<string, string>)[s] || s; }
function fmt(iso: string) { return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }

// Uptime bar segments come straight from recorded checks (newest-last). If we
// don't have 90 yet, pad the left with 'none' so the bar is full-width.
function barSegments(c: any) {
  const recent: string[] = Array.isArray(c.recent) ? c.recent : [];
  const total = 90;
  const pad = Math.max(0, total - recent.length);
  return [...Array(pad).fill('none'), ...recent];
}

onMounted(async () => {
  const rc = useRuntimeConfig();
  appBase.value = (rc.public?.appBaseUrl as string) || window.location.origin;
  const onScroll = () => {
    const scrolled = window.scrollY;
    const max = document.documentElement.scrollHeight - window.innerHeight;
    showTop.value = scrolled > 500 && (max - scrolled) < max * 0.5;
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
  nowLabel.value = new Date().toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  try {
    const d = await $fetch<any>('/api/status');
    components.value = d.components || [];
    incidents.value = d.incidents || [];
    overall.value = d.overall || 'operational';
  } catch { /* */ }
});
</script>

<style>
.st * { box-sizing: border-box; }
.st {
  --s-bg: #fbfaf8; --s-panel: #ffffff; --s-ink: #14141a; --s-soft: #5b5b64; --s-mute: #8a8a93;
  --s-rule: #e7e5e0; --s-signal: #1a4b72; --s-radius: 14px;
  --s-ok: #1a7a4f; --s-ok-soft: rgba(26,122,79,0.12);
  --s-warn: #b8860b; --s-warn-soft: rgba(184,134,11,0.13);
  --s-bad: #c0392b; --s-bad-soft: rgba(192,57,43,0.12);
  --s-maint: #1a4b72; --s-maint-soft: rgba(26,75,114,0.1);
  font-family: "Geist", -apple-system, BlinkMacSystemFont, sans-serif;
  color: var(--s-ink); background: var(--s-bg); min-height: 100vh;
}
.st a { color: var(--s-signal); text-decoration: none; }
.st a:hover { text-decoration: underline; }
.st-top { position: sticky; top: 0; z-index: 10; background: rgba(251,250,248,0.85); backdrop-filter: blur(10px); border-bottom: 1px solid var(--s-rule); }
.st-top-inner { max-width: 880px; margin: 0 auto; padding: 14px 20px; display: flex; align-items: center; justify-content: space-between; }
.st-logo { display: flex; align-items: center; gap: 10px; }
.st-logo img { height: 24px; }
.st-logo-tag { font-size: 12px; font-weight: 600; color: var(--s-mute); border: 1px solid var(--s-rule); padding: 1px 8px; border-radius: 999px; }
.st-top-btn { font-size: 13.5px; font-weight: 600; color: var(--s-ink); }
.st-main { max-width: 880px; margin: 0 auto; padding: 36px 20px 100px; }

/* Hero banner */
.st-hero { display: flex; align-items: center; gap: 18px; padding: 26px 28px; border-radius: 18px; margin-bottom: 22px; border: 1px solid var(--s-rule); background: var(--s-panel); position: relative; overflow: hidden; }
.st-hero.ov-operational { background: linear-gradient(120deg, rgba(26,122,79,0.08), rgba(26,122,79,0.02)); border-color: rgba(26,122,79,0.25); }
.st-hero.ov-degraded, .st-hero.ov-maintenance { background: linear-gradient(120deg, var(--s-warn-soft), transparent); border-color: rgba(184,134,11,0.3); }
.st-hero.ov-partial_outage, .st-hero.ov-major_outage { background: linear-gradient(120deg, var(--s-bad-soft), transparent); border-color: rgba(192,57,43,0.3); }
.st-hero-dot { flex: none; width: 44px; height: 44px; border-radius: 999px; display: flex; align-items: center; justify-content: center; }
.st-hero-dot span { width: 14px; height: 14px; border-radius: 999px; background: var(--s-ok); box-shadow: 0 0 0 6px var(--s-ok-soft); animation: stPulse 2.4s ease-in-out infinite; }
.ov-degraded .st-hero-dot span, .ov-maintenance .st-hero-dot span { background: var(--s-warn); box-shadow: 0 0 0 6px var(--s-warn-soft); }
.ov-partial_outage .st-hero-dot span, .ov-major_outage .st-hero-dot span { background: var(--s-bad); box-shadow: 0 0 0 6px var(--s-bad-soft); }
@keyframes stPulse { 0%,100% { box-shadow: 0 0 0 5px var(--s-ok-soft); } 50% { box-shadow: 0 0 0 10px transparent; } }
.st-hero-title { font-family: "Fraunces", Georgia, serif; font-size: 26px; margin: 0 0 4px; letter-spacing: -0.01em; }
.st-hero-sub { font-size: 14px; color: var(--s-soft); margin: 0; }
.st-hero-time { margin-left: auto; font-size: 12px; color: var(--s-mute); white-space: nowrap; align-self: flex-start; }

/* Active incident */
.st-active { border: 1px solid var(--s-rule); border-left: 4px solid var(--s-warn); border-radius: var(--s-radius); padding: 18px 20px; margin-bottom: 22px; background: var(--s-panel); }
.st-active.im-major, .st-active.im-critical { border-left-color: var(--s-bad); }
.st-active-head { display: flex; align-items: center; gap: 12px; margin-bottom: 8px; }
.st-active-head h3 { font-size: 16px; margin: 0; }
.st-active-badge { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--s-warn); background: var(--s-warn-soft); padding: 3px 9px; border-radius: 999px; }
.st-active-body { font-size: 14px; color: var(--s-soft); line-height: 1.6; margin: 0 0 8px; }
.st-active-meta { font-size: 12px; color: var(--s-mute); }

/* Cards */
.st-card { background: var(--s-panel); border: 1px solid var(--s-rule); border-radius: var(--s-radius); padding: 8px 24px 20px; margin-bottom: 22px; }
.st-card-head { display: flex; align-items: center; justify-content: space-between; padding: 16px 0 10px; }
.st-card-head h2 { font-size: 16px; margin: 0; }
.st-legend { font-size: 12px; color: var(--s-mute); display: flex; align-items: center; gap: 7px; }

/* Component row */
.st-comp { padding: 16px 0; border-top: 1px solid var(--s-rule); }
.st-comp-main { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 10px; }
.st-comp-name { font-weight: 600; font-size: 15px; }
.st-comp-desc { display: block; font-weight: 400; font-size: 12.5px; color: var(--s-mute); margin-top: 2px; }
.st-comp-status { display: flex; align-items: center; gap: 7px; font-size: 13px; font-weight: 500; white-space: nowrap; }
.st-comp-status.operational { color: var(--s-ok); }
.st-comp-status.degraded, .st-comp-status.maintenance { color: var(--s-warn); }
.st-comp-status.partial_outage, .st-comp-status.major_outage { color: var(--s-bad); }
.st-pip { width: 9px; height: 9px; border-radius: 999px; flex: none; }
.st-pip.operational { background: var(--s-ok); }
.st-pip.degraded, .st-pip.maintenance { background: var(--s-warn); }
.st-pip.partial_outage, .st-pip.major_outage { background: var(--s-bad); }

/* Uptime bars */
.st-bars { display: flex; gap: 2px; height: 30px; align-items: stretch; }
.st-bar { flex: 1; border-radius: 2px; min-width: 0; transition: opacity .12s; }
.st-bar.up { background: var(--s-ok); opacity: 0.78; }
.st-bar.up:hover { opacity: 1; }
.st-bar.down { background: var(--s-bad); }
.st-bar.unknown { background: var(--s-mute); opacity: 0.4; }
.st-bar.none { background: var(--s-rule); }
.st-pip.unknown { background: var(--s-mute); }
.st-comp-status.unknown { color: var(--s-mute); }
.st-bars-foot { display: flex; justify-content: space-between; align-items: center; margin-top: 7px; font-size: 11.5px; color: var(--s-mute); }
.st-uptime { font-weight: 600; color: var(--s-soft); }

/* Incidents */
.st-empty { padding: 26px 0; text-align: center; color: var(--s-mute); font-size: 14px; }
.st-inc { padding: 16px 0; border-top: 1px solid var(--s-rule); }
.st-inc-row { display: flex; gap: 14px; }
.st-inc-impact { flex: none; width: 8px; height: 8px; border-radius: 999px; margin-top: 6px; background: var(--s-warn); }
.st-inc-impact.im-major, .st-inc-impact.im-critical { background: var(--s-bad); }
.st-inc-impact.im-none, .st-inc-impact.im-maintenance { background: var(--s-maint); }
.st-inc-title { font-weight: 600; font-size: 14.5px; margin-bottom: 4px; }
.st-inc-text { font-size: 13.5px; color: var(--s-soft); line-height: 1.55; margin-bottom: 6px; }
.st-inc-meta { display: flex; gap: 12px; align-items: center; font-size: 12px; color: var(--s-mute); }
.st-inc-state { font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; font-size: 10.5px; padding: 2px 7px; border-radius: 999px; background: var(--s-ok-soft); color: var(--s-ok); }

.st-foot { display: flex; gap: 18px; justify-content: center; align-items: center; padding-top: 12px; font-size: 13px; color: var(--s-mute); }
.st-totop { position: fixed; left: 24px; bottom: 24px; z-index: 60; width: 44px; height: 44px; border-radius: 999px; border: 1px solid var(--s-rule); background: var(--s-panel); color: var(--s-ink); cursor: pointer; display: flex; align-items: center; justify-content: center; box-shadow: 0 8px 24px -10px rgba(10,10,11,0.35); transition: transform .15s, box-shadow .15s; }
.st-totop:hover { transform: translateY(-2px); box-shadow: 0 12px 30px -10px rgba(10,10,11,0.4); }
.st-totop svg { width: 19px; height: 19px; }

@media (max-width: 600px) { .st-hero { flex-wrap: wrap; } .st-hero-time { margin-left: 0; width: 100%; } }
</style>
