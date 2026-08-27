<template>
  <div class="gd">
    <header class="gd-top">
      <span class="gd-ws">A guided tour</span>
      <span class="gd-sp" />
      <!-- Signed out this is a prospect, so the useful thing is a way in.
           Signed in it is a client who came from their dashboard and wants a
           way back. -->
      <NuxtLink v-if="!signedIn" to="/login" class="gd-signin">Sign in</NuxtLink>
      <div v-else class="gd-me" @click="menu = !menu">
        <span class="gd-av">{{ initials }}</span>
        <div v-if="menu" class="gd-menu">
          <NuxtLink to="/" class="gd-mi">Return to dashboard</NuxtLink>
          <NuxtLink to="/settings" class="gd-mi">Settings</NuxtLink>
        </div>
      </div>
    </header>

    <div class="gd-stage">
      <!-- On a phone the rail becomes a single row that opens on tap: 17 steps
           stacked above the content would push the first screen off the fold. -->
      <button class="gd-railtoggle" @click="railOpen = !railOpen">
        <span>{{ cur ? cur.t : 'Contents' }}</span>
        <span class="gd-caret" :class="{ up: railOpen }">&#9662;</span>
      </button>

      <aside class="gd-rail" :class="{ open: railOpen }">
        <div class="gd-railhead">
          <div class="gd-brand">The platform</div>
          <p class="gd-brandsub">From the front page to a live call, in {{ steps.length }} screens.</p>
        </div>
        <nav>
          <template v-for="g in TOUR" :key="g.g">
            <div class="gd-grp">{{ g.g }}</div>
            <button v-for="s in g.items" :key="s.id"
                    class="gd-link" :class="{ on: active === s.id }"
                    @click="go(s.id); railOpen = false">
              <span class="gd-lbl">{{ s.t }}</span>
            </button>
          </template>
        </nav>
      </aside>

      <section class="gd-main" v-if="cur">
        <div class="gd-eyebrow">{{ cur.g }} &middot; {{ cur.n }} of {{ steps.length }}</div>
        <h1 class="gd-h">{{ cur.t }}</h1>
        <p class="gd-lede">{{ cur.lede }}</p>

        <!-- The real page, framed. A drawn copy would drift the next time we
             changed the design; this cannot. -->
        <div class="gd-screen" v-if="cur.src">
          <div class="gd-chrome">
            <span class="gd-dotc" /><span class="gd-dotc" /><span class="gd-dotc" />
            <span class="gd-url">{{ pretty(cur.src) }}</span>
            <a v-if="external(cur.src)" :href="cur.src" target="_blank" class="gd-open">Open</a>
            <NuxtLink v-else :to="cur.src" class="gd-open">Open</NuxtLink>
          </div>
          <iframe :key="cur.id" :src="cur.src" class="gd-frame" loading="lazy" title="Preview" />
        </div>

        <!-- A step that links out rather than framing. -->
        <a v-if="cur.ext" :href="cur.ext" target="_blank" class="gd-extlink">
          <span>{{ pretty(cur.ext) }}</span>
          <span class="gd-extgo">Open &rarr;</span>
        </a>

        <div class="gd-do">
          <ul class="gd-body">
            <li v-for="(d, i) in cur.body" :key="i" v-html="d" />
          </ul>
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
          <button v-if="next" class="gd-btn gd-btn-pri" @click="go(next.id)">{{ next.t }} &rarr;</button>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { TOUR } from '~/composables/useGuideTour';
import { useAuthStore } from '~/stores/auth';

/* Its own page rather than the app shell: somebody being walked through the
   platform is reading, not navigating. Nothing here reads the caller's
   workspace — the setup panel in their sidebar already tracks what they have
   done, and keeping this independent of it is also what lets an admin open it. */
definePageMeta({ layout: 'bare' });
useHead({
  title: 'A guided tour — Telroi',
  // The same Live Call widget the marketing site offers visitors. Somebody
  // being walked through the product should be able to ask a question without
  // finding a contact page first.
  script: [{
    src: 'https://app.telroi.ai/widget/v1.js',
    'data-telroi-key': 'wgt_ec9ae0fdd28f1a2a4a73b0a65dde9437',
    async: true
  }]
});

const steps = computed(() => {
  let n = 0;
  return TOUR.flatMap(g => g.items.map(it => ({ ...it, n: ++n, g: g.g })));
});

const active = ref(steps.value[0]?.id || 'front');
const cur  = computed(() => steps.value.find(s => s.id === active.value) || null);
const idx  = computed(() => steps.value.findIndex(s => s.id === active.value));
const prev = computed(() => steps.value[idx.value - 1] || null);
const next = computed(() => steps.value[idx.value + 1] || null);

/* Who is reading. A prospect gets a way in; a client who wandered here from
   their dashboard gets a way back. The store is already populated for a signed-
   in visitor, and empty for everyone else, so nothing needs fetching. */
const auth = useAuthStore();
const menu = ref(false);
const railOpen = ref(false);
const signedIn = computed(() => !!auth.user);
const initials = computed(() => {
  const n = auth.user?.name || auth.user?.email || '';
  return n.split(/[\s@.]+/).filter(Boolean).slice(0, 2)
    .map((w: string) => w[0]?.toUpperCase()).join('') || '?';
});

const external = (u: string) => /^https?:/.test(u);
const pretty = (u: string) => external(u) ? u.replace(/^https?:\/\//, '') : 'app.telroi.ai' + u;

onMounted(() => {
  const h = location.hash.slice(1);
  if (h && steps.value.some(s => s.id === h)) active.value = h;
});

function go(id: string) {
  active.value = id;
  history.replaceState(null, '', '#' + id);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
</script>

<style scoped>
.gd { width: 100%; max-width: 1060px; }

.gd-top { display: flex; align-items: center; justify-content: space-between;
  padding-bottom: 18px; margin-bottom: 26px; border-bottom: 1px solid var(--rule); }
.gd-back { font-size: 12.5px; color: var(--ink-mute); text-decoration: none; }
.gd-signin { font-size: 12.5px; font-weight: 600; color: var(--signal);
  text-decoration: none; padding: 6px 14px; border-radius: 999px;
  background: var(--signal-soft); }
.gd-me { position: relative; cursor: pointer; }
.gd-av { width: 28px; height: 28px; border-radius: 50%; background: var(--signal);
  color: #fff; font-size: 11px; font-weight: 600; display: flex; align-items: center;
  justify-content: center; }
.gd-menu { position: absolute; right: 0; top: 36px; min-width: 178px; z-index: 20;
  background: var(--paper); border: 1px solid var(--rule); border-radius: var(--radius);
  padding: 5px; box-shadow: 0 12px 30px -10px rgba(10, 10, 11, .2); }
.gd-mi { display: block; font-size: 12.5px; color: var(--ink); text-decoration: none;
  padding: 8px 11px; border-radius: 7px; }
.gd-mi:hover { background: var(--paper-3); }
.gd-back:hover { color: var(--ink); }
.gd-ws { font-size: 12px; color: var(--ink-mute); }

.gd-stage { display: grid; grid-template-columns: 220px minmax(0, 1fr); gap: 40px;
  align-items: start; }

.gd-rail { position: sticky; top: 20px; max-height: calc(100vh - 40px); overflow-y: auto; }
.gd-railhead { margin-bottom: 18px; }
.gd-brand { font-size: 14.5px; font-weight: 600; }
.gd-brandsub { font-size: 11.5px; color: var(--ink-mute); margin: 3px 0 0; line-height: 1.5; }

.gd-grp { font-size: 10px; text-transform: uppercase; letter-spacing: .08em;
  color: var(--ink-mute); font-weight: 600; margin: 18px 0 6px; }
.gd-grp:first-child { margin-top: 0; }
.gd-link { display: block; width: 100%; text-align: left; font-size: 12.5px;
  color: var(--ink-soft); padding: 5px 9px; border-radius: 7px; border: 0;
  background: none; cursor: pointer; line-height: 1.45; }
.gd-link:hover { background: var(--paper-3); color: var(--ink); }
.gd-link.on { background: var(--signal-soft); color: var(--signal); font-weight: 600; }

.gd-main { max-width: 660px; }
.gd-eyebrow { font-size: 10.5px; text-transform: uppercase; letter-spacing: .09em;
  color: var(--ink-mute); font-weight: 600; margin-bottom: 8px; }
.gd-h { font-size: 27px; line-height: 1.16; letter-spacing: -.02em; font-weight: 600;
  margin: 0 0 12px; }
.gd-lede { font-size: 15.5px; line-height: 1.62; color: var(--ink-soft); margin: 0 0 22px; }

/* A tablet-ish frame: rounded, a light chrome strip, the page beneath it. */
.gd-screen { border: 1px solid var(--rule); border-radius: 14px; overflow: hidden;
  background: var(--paper); margin-bottom: 22px;
  box-shadow: 0 18px 40px -20px rgba(10, 10, 11, .22); }
.gd-chrome { height: 34px; background: var(--paper-3); border-bottom: 1px solid var(--rule);
  display: flex; align-items: center; gap: 6px; padding: 0 12px; }
.gd-dotc { width: 8px; height: 8px; border-radius: 50%; background: var(--rule-2); flex: 0 0 auto; }
.gd-url { flex: 1; margin-left: 8px; font-size: 10.5px; color: var(--ink-mute);
  font-family: var(--font-mono, monospace); overflow: hidden; text-overflow: ellipsis;
  white-space: nowrap; }
.gd-open { font-size: 10.5px; font-weight: 600; color: var(--signal); text-decoration: none;
  padding: 3px 9px; border-radius: 999px; background: var(--signal-soft); flex: 0 0 auto; }
/* Scaled so a desktop layout fits the column and still looks like itself: the
   width is the inverse of the scale, and the negative margin absorbs the space
   the untransformed height would otherwise leave behind. */
.gd-frame { width: 166.67%; height: 700px; border: 0; display: block;
  transform: scale(.6); transform-origin: 0 0; margin-bottom: -280px;
  background: var(--paper-2); }

.gd-extlink { display: flex; align-items: center; justify-content: space-between;
  gap: 14px; border: 1px solid var(--rule); border-radius: var(--radius);
  padding: 15px 18px; margin-bottom: 22px; background: var(--paper);
  text-decoration: none; color: var(--ink); font-size: 13.5px; }
.gd-extlink:hover { border-color: var(--signal); }
.gd-extgo { font-size: 12px; font-weight: 600; color: var(--signal); flex: 0 0 auto; }

.gd-do { border: 1px solid var(--rule); border-radius: var(--radius); padding: 18px 22px;
  background: var(--paper); }
.gd-body { margin: 0; padding: 0; list-style: none; }
.gd-body li { position: relative; padding-left: 18px; margin-bottom: 11px;
  font-size: 13.5px; line-height: 1.65; }
.gd-body li:last-child { margin-bottom: 0; }
.gd-body li::before { content: ""; position: absolute; left: 2px; top: .68em; width: 5px;
  height: 5px; border-radius: 50%; background: var(--signal); opacity: .5; }

.gd-watch { border: 1px solid var(--rule); border-left: 3px solid var(--signal);
  border-radius: var(--radius); padding: 14px 17px; margin-top: 16px; background: var(--paper); }
.gd-watch-h { font-size: 10.5px; text-transform: uppercase; letter-spacing: .07em;
  font-weight: 600; color: var(--signal); margin-bottom: 4px; }
.gd-watch p { margin: 0; font-size: 13px; line-height: 1.62; color: var(--ink-soft); }

.gd-know { margin-top: 18px; }
.gd-know ul { margin: 0; padding: 0; list-style: none; }
.gd-know li { position: relative; padding-left: 15px; margin-bottom: 6px; font-size: 12.5px;
  line-height: 1.55; color: var(--ink-mute); }
.gd-know li::before { content: ""; position: absolute; left: 2px; top: .6em; width: 3.5px;
  height: 3.5px; border-radius: 50%; background: var(--signal); opacity: .5; }

.gd-btn { font-size: 12.5px; font-weight: 600; padding: 8px 15px; border-radius: 8px;
  border: 1px solid var(--rule); background: var(--paper); color: var(--ink); cursor: pointer; }
.gd-btn-pri { background: var(--signal); border-color: var(--signal); color: #fff; }

.gd-foot { display: flex; align-items: center; margin-top: 30px; padding-top: 18px;
  border-top: 1px solid var(--rule); }
.gd-sp { flex: 1; }

/* Desktop keeps the rail open beside the content and has no need of a toggle. */
.gd-railtoggle { display: none; }

@media (max-width: 900px) {
  .gd-stage { grid-template-columns: 1fr; gap: 0; }
  .gd-h { font-size: 23px; }
  .gd-frame { height: 560px; margin-bottom: -224px; }

  .gd-railtoggle { display: flex; align-items: center; justify-content: space-between;
    width: 100%; gap: 12px; padding: 12px 15px; margin-bottom: 14px;
    border: 1px solid var(--rule); border-radius: var(--radius);
    background: var(--paper); font-size: 13.5px; font-weight: 600; text-align: left; }
  .gd-caret { color: var(--ink-mute); font-size: 11px; transition: transform .2s; }
  .gd-caret.up { transform: rotate(180deg); }

  /* Closed by default: seventeen steps stacked above the content would push the
     screen itself off the fold, which is the thing somebody came to look at. */
  .gd-rail { position: static; max-height: none; display: none;
    border: 1px solid var(--rule); border-radius: var(--radius);
    padding: 14px 15px; margin-bottom: 20px; background: var(--paper); }
  .gd-rail.open { display: block; }
  .gd-railhead { display: none; }
  .gd-grp:first-child { margin-top: 0; }
}
</style>
