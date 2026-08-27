<template>
  <div class="gd">
    <!-- A light strip rather than the app's topbar. Somebody reading this is
         mid-setup, not navigating. -->
    <header class="gd-top">
      <NuxtLink to="/" class="gd-back">&larr; Back to Telroi</NuxtLink>
      <span class="gd-ws">{{ ws }}</span>
    </header>

    <div class="gd-stage">
      <aside class="gd-rail">
        <div class="gd-railhead">
          <div class="gd-brand">Your setup</div>
          <p class="gd-brandsub">{{ doneCount }} of {{ steps.length }} done</p>
          <div class="gd-bar"><div class="gd-fill" :style="{ width: pct + '%' }" /></div>
        </div>
        <nav>
          <template v-for="g in groups" :key="g.label">
            <div class="gd-grp">{{ g.label }}</div>
            <button v-for="s in g.steps" :key="s.id"
                    class="gd-link" :class="{ on: active === s.id, dn: s.done }"
                    @click="go(s.id)">
              <span class="gd-dot" :class="{ dn: s.done }">
                <span v-if="s.done">&#10003;</span><span v-else>{{ s.n }}</span>
              </span>
              <span class="gd-lbl">{{ s.t }}</span>
            </button>
          </template>
        </nav>
      </aside>

      <section class="gd-main" v-if="cur">
        <div class="gd-eyebrow">Step {{ cur.n }} of {{ steps.length }}</div>
        <h1 class="gd-h">{{ cur.t }}</h1>

        <!-- Where they actually stand, not a description of the feature. -->
        <div class="gd-state" :class="cur.state.tone">
          <span class="gd-state-dot" />
          <div>
            <div class="gd-state-h">{{ cur.state.h }}</div>
            <p v-if="cur.state.p">{{ cur.state.p }}</p>
          </div>
        </div>

        <div class="gd-do">
          <ol class="gd-steps">
            <li v-for="(d, i) in cur.doThis" :key="i" v-html="d" />
          </ol>
          <div class="gd-actions">
            <NuxtLink :to="cur.to" class="gd-btn gd-btn-pri">{{ cur.cta }}</NuxtLink>
            <button v-if="next" class="gd-btn gd-btn-gho" @click="go(next.id)">Skip for now</button>
          </div>
        </div>

        <div v-if="cur.watch" class="gd-watch">
          <div class="gd-watch-h">Watch out</div>
          <p v-html="cur.watch" />
        </div>

        <div v-if="cur.know" class="gd-know">
          <ul><li v-for="(k, i) in cur.know" :key="i" v-html="k" /></ul>
        </div>

        <div class="gd-foot">
          <button v-if="prev" class="gd-btn" @click="go(prev.id)">&larr; {{ prev.t }}</button>
          <span class="gd-sp" />
          <button v-if="next" class="gd-btn" @click="go(next.id)">{{ next.t }} &rarr;</button>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useGuideSteps } from '~/composables/useGuideSteps';

/* Its own page rather than the app shell: bare gives a centred logo and a clean
   field. auth.global.ts already means this is signed-in only, so there is
   nothing to guard here. */
definePageMeta({ layout: 'bare' });
useHead({ title: 'Your setup — Telroi' });

const { ws, steps, groups, doneCount, pct } = useGuideSteps();

const active = ref('wallet');
const cur  = computed(() => steps.value.find(s => s.id === active.value) || null);
const idx  = computed(() => steps.value.findIndex(s => s.id === active.value));
const prev = computed(() => steps.value[idx.value - 1] || null);
const next = computed(() => steps.value[idx.value + 1] || null);

onMounted(() => {
  // A link to a specific step wins; otherwise open at the first thing still
  // outstanding, since that is what they came for.
  const h = location.hash.slice(1);
  if (h && steps.value.some(s => s.id === h)) { active.value = h; return; }
  const first = steps.value.find(s => !s.done);
  if (first) active.value = first.id;
});

function go(id: string) {
  active.value = id;
  history.replaceState(null, '', '#' + id);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
</script>

<style scoped>
.gd { width: 100%; max-width: 1000px; }

.gd-top { display: flex; align-items: center; justify-content: space-between;
  padding-bottom: 18px; margin-bottom: 26px; border-bottom: 1px solid var(--rule); }
.gd-back { font-size: 12.5px; color: var(--ink-mute); text-decoration: none; }
.gd-back:hover { color: var(--ink); }
.gd-ws { font-size: 12px; color: var(--ink-mute); }

.gd-stage { display: grid; grid-template-columns: 232px minmax(0, 1fr); gap: 44px;
  align-items: start; }

.gd-rail { position: sticky; top: 20px; }
.gd-railhead { margin-bottom: 20px; }
.gd-brand { font-size: 14.5px; font-weight: 600; }
.gd-brandsub { font-size: 11.5px; color: var(--ink-mute); margin: 3px 0 9px; }
.gd-bar { height: 3px; background: var(--paper-3); border-radius: 999px; overflow: hidden; }
.gd-fill { height: 100%; background: var(--signal); border-radius: 999px; transition: width .35s; }

.gd-grp { font-size: 10px; text-transform: uppercase; letter-spacing: .08em;
  color: var(--ink-mute); font-weight: 600; margin: 18px 0 7px; }
.gd-grp:first-child { margin-top: 0; }
.gd-link { display: flex; align-items: center; gap: 10px; width: 100%; text-align: left;
  font-size: 13px; color: var(--ink-soft); padding: 6px 9px; border-radius: 8px; border: 0;
  background: none; cursor: pointer; line-height: 1.4; }
.gd-link:hover { background: var(--paper-3); color: var(--ink); }
.gd-link.on { background: var(--signal-soft); color: var(--signal); font-weight: 600; }
.gd-dot { width: 19px; height: 19px; border-radius: 50%; background: var(--paper-3);
  color: var(--ink-mute); font-size: 10.5px; font-weight: 600; display: flex;
  align-items: center; justify-content: center; flex: 0 0 auto; }
.gd-dot.dn { background: var(--green-ink, #0a8a5c); color: #fff; }
.gd-link.on .gd-dot:not(.dn) { background: var(--signal); color: #fff; }
.gd-link.dn .gd-lbl { color: var(--ink-mute); }
.gd-link.on.dn .gd-lbl { color: var(--signal); }

.gd-main { max-width: 620px; }
.gd-eyebrow { font-size: 10.5px; text-transform: uppercase; letter-spacing: .1em;
  color: var(--ink-mute); font-weight: 600; margin-bottom: 8px; }
.gd-h { font-size: 27px; line-height: 1.16; letter-spacing: -.02em; font-weight: 600;
  margin: 0 0 18px; }

.gd-state { display: flex; gap: 12px; align-items: flex-start; padding: 14px 17px;
  border-radius: var(--radius); margin-bottom: 22px; background: var(--paper);
  border: 1px solid var(--rule); }
.gd-state-dot { width: 8px; height: 8px; border-radius: 50%; flex: 0 0 auto; margin-top: 6px;
  background: var(--ink-mute); }
.gd-state-h { font-size: 14px; font-weight: 600; }
.gd-state p { font-size: 13px; color: var(--ink-soft); margin: 3px 0 0; line-height: 1.55; }
.gd-state.ok { border-color: color-mix(in srgb, var(--green-ink, #0a8a5c) 30%, var(--rule)); }
.gd-state.ok .gd-state-dot { background: var(--green-ink, #0a8a5c); }
.gd-state.wait .gd-state-dot { background: var(--warn); }
.gd-state.todo .gd-state-dot { background: var(--signal); }
.gd-state.opt .gd-state-dot { background: var(--rule-2); }

.gd-do { border: 1px solid var(--rule); border-radius: var(--radius); padding: 20px 22px;
  background: var(--paper); }
.gd-steps { counter-reset: gs; margin: 0; padding: 0; list-style: none; }
.gd-steps li { counter-increment: gs; position: relative; padding-left: 30px;
  margin-bottom: 11px; font-size: 13.5px; line-height: 1.62; }
.gd-steps li:last-child { margin-bottom: 0; }
.gd-steps li::before { content: counter(gs); position: absolute; left: 0; top: 1px;
  width: 20px; height: 20px; border-radius: 50%; background: var(--signal-soft);
  color: var(--signal); font-size: 10.5px; font-weight: 600; display: flex;
  align-items: center; justify-content: center; }
.gd-actions { display: flex; gap: 9px; margin-top: 18px; flex-wrap: wrap; }

.gd-btn { font-size: 12.5px; font-weight: 600; padding: 8px 15px; border-radius: 8px;
  border: 1px solid var(--rule); background: var(--paper); color: var(--ink);
  cursor: pointer; text-decoration: none; display: inline-block; }
.gd-btn-pri { background: var(--signal); border-color: var(--signal); color: #fff; }
.gd-btn-gho { border-color: transparent; color: var(--ink-mute); }
.gd-btn-gho:hover { color: var(--ink); }

.gd-watch { border: 1px solid var(--rule); border-left: 3px solid var(--warn);
  border-radius: var(--radius); padding: 14px 17px; margin-top: 16px; background: var(--paper); }
.gd-watch-h { font-size: 10.5px; text-transform: uppercase; letter-spacing: .07em;
  font-weight: 600; color: var(--warn); margin-bottom: 4px; }
.gd-watch p { margin: 0; font-size: 13px; line-height: 1.6; color: var(--ink-soft); }

.gd-know { margin-top: 18px; }
.gd-know ul { margin: 0; padding: 0; list-style: none; }
.gd-know li { position: relative; padding-left: 15px; margin-bottom: 6px; font-size: 12.5px;
  line-height: 1.55; color: var(--ink-mute); }
.gd-know li::before { content: ""; position: absolute; left: 2px; top: .6em; width: 3.5px;
  height: 3.5px; border-radius: 50%; background: var(--signal); opacity: .5; }

.gd-foot { display: flex; align-items: center; margin-top: 30px; padding-top: 18px;
  border-top: 1px solid var(--rule); }
.gd-sp { flex: 1; }

@media (max-width: 900px) {
  .gd-stage { grid-template-columns: 1fr; gap: 26px; }
  .gd-rail { position: static; }
  .gd-h { font-size: 23px; }
}
</style>
