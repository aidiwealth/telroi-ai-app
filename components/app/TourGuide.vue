<template>
  <Teleport to="body">
    <div v-if="active && current" class="tour-root" :class="{ 'tour-centered': !targetRect }" @keydown.esc="skip">
      <!-- Full-viewport dim. When a target exists, the spotlight is a transparent
           box whose huge box-shadow fills the ENTIRE viewport with the dim colour
           — so there is never an uncovered edge regardless of viewport size. -->
      <div v-if="!targetRect" class="tour-dim" @click="skip" />
      <div v-else class="tour-spotlight" :style="spotlightStyle" @click="skip" />

      <!-- Glow ring around the spotlighted element -->
      <div v-if="targetRect" class="tour-ring" :style="ringStyle" />

      <!-- The coachmark card -->
      <div ref="card" class="tour-card" :class="`tour-place-${placement}`" :style="cardStyle" @click.stop>
        <div v-if="targetRect" class="tour-arrow" :class="`arrow-${placement}`" :style="arrowStyle" />
        <div class="tour-card-head">
          <span class="tour-step-label">{{ stepIndex + 1 }} <span class="tour-step-of">of {{ total }}</span></span>
          <button class="tour-x" aria-label="Close tour" @click="skip">
            <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 4l8 8M12 4l-8 8" stroke-linecap="round"/></svg>
          </button>
        </div>
        <h3 class="tour-title">{{ current.title }}</h3>
        <p class="tour-body">{{ current.body }}</p>
        <div class="tour-foot">
          <div class="tour-dots">
            <button v-for="(s, i) in steps" :key="i" class="tour-dot" :class="{ on: i === stepIndex, done: i < stepIndex }" :aria-label="`Go to step ${i + 1}`" @click="goTo(i)" />
          </div>
          <div class="tour-actions">
            <button v-if="!isFirst" class="tour-btn ghost" @click="prev">Back</button>
            <button class="tour-btn primary" @click="next">{{ isLast ? 'Finish' : 'Next' }}</button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue';
import { useTour } from '~/composables/useTour';

const { active, current, steps, stepIndex, total, isFirst, isLast, next, prev, goTo, skip } = useTour();

const vw = ref(typeof window !== 'undefined' ? window.innerWidth : 1280);
const vh = ref(typeof window !== 'undefined' ? window.innerHeight : 800);
const targetRect = ref<DOMRect | null>(null);
const card = ref<HTMLElement | null>(null);
const placement = ref<'top' | 'bottom' | 'left' | 'right' | 'center'>('bottom');

const PAD = 8;          // spotlight padding around the target
const GAP = 16;         // gap between target and card
const CARD_W = 340;
const CARD_H_EST = 200;

const hole = computed(() => {
  const r = targetRect.value;
  if (!r) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: r.left - PAD, y: r.top - PAD, w: r.width + PAD * 2, h: r.height + PAD * 2 };
});
// The spotlight is a transparent box positioned over the target; its enormous
// spread box-shadow paints the dim over the whole viewport with no edge gaps.
const spotlightStyle = computed(() => {
  const h = hole.value;
  return {
    left: `${h.x}px`, top: `${h.y}px`, width: `${h.w}px`, height: `${h.h}px`,
    boxShadow: '0 0 0 9999px rgba(10,10,11,0.55)'
  };
});
const ringStyle = computed(() => {
  const r = targetRect.value; if (!r) return {};
  return { left: `${r.left - PAD}px`, top: `${r.top - PAD}px`, width: `${r.width + PAD * 2}px`, height: `${r.height + PAD * 2}px` };
});

// Find the target, scroll it into view, measure it.
async function locate() {
  const key = current.value?.target;
  if (!key) { targetRect.value = null; placement.value = 'center'; await nextTick(); position(); return; }
  await nextTick();
  // give a route change / DOM a beat to settle, then find the anchor
  let el: HTMLElement | null = null;
  for (let i = 0; i < 12; i++) {
    el = document.querySelector(`[data-tour="${key}"]`) as HTMLElement | null;
    if (el) break;
    await new Promise((r) => setTimeout(r, 60));
  }
  if (!el) { targetRect.value = null; placement.value = 'center'; position(); return; }
  el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
  await new Promise((r) => setTimeout(r, 280));
  measure();
}
function measure() {
  const key = current.value?.target;
  const el = key ? (document.querySelector(`[data-tour="${key}"]`) as HTMLElement | null) : null;
  targetRect.value = el ? el.getBoundingClientRect() : null;
  position();
}

const cardPos = ref<{ left: number; top: number }>({ left: 0, top: 0 });
const arrowOffset = ref(0);
function position() {
  vw.value = window.innerWidth; vh.value = window.innerHeight;
  const r = targetRect.value;
  if (!r) { // centered card
    cardPos.value = { left: (vw.value - CARD_W) / 2, top: (vh.value - CARD_H_EST) / 2 };
    placement.value = 'center';
    return;
  }
  const want = current.value?.placement || 'auto';
  const spaceBelow = vh.value - r.bottom, spaceAbove = r.top, spaceRight = vw.value - r.right, spaceLeft = r.left;
  let place: typeof placement.value = 'bottom';
  if (want !== 'auto') place = want;
  else if (spaceBelow > CARD_H_EST + GAP) place = 'bottom';
  else if (spaceAbove > CARD_H_EST + GAP) place = 'top';
  else if (spaceRight > CARD_W + GAP) place = 'right';
  else if (spaceLeft > CARD_W + GAP) place = 'left';
  else place = 'bottom';

  let left = 0, top = 0;
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  if (place === 'bottom') { top = r.bottom + GAP; left = cx - CARD_W / 2; }
  else if (place === 'top') { top = r.top - GAP - CARD_H_EST; left = cx - CARD_W / 2; }
  else if (place === 'right') { left = r.right + GAP; top = cy - CARD_H_EST / 2; }
  else { left = r.left - GAP - CARD_W; top = cy - CARD_H_EST / 2; }

  // clamp to viewport
  const m = 12;
  left = Math.max(m, Math.min(left, vw.value - CARD_W - m));
  top = Math.max(m, Math.min(top, vh.value - CARD_H_EST - m));
  // arrow points at target center along the relevant axis
  if (place === 'top' || place === 'bottom') arrowOffset.value = Math.max(16, Math.min(cx - left, CARD_W - 16));
  else arrowOffset.value = Math.max(16, Math.min(cy - top, CARD_H_EST - 16));
  cardPos.value = { left, top };
  placement.value = place;
}
const cardStyle = computed(() => ({ left: `${cardPos.value.left}px`, top: `${cardPos.value.top}px`, width: `${CARD_W}px` }));
const arrowStyle = computed(() => {
  if (placement.value === 'top' || placement.value === 'bottom') return { left: `${arrowOffset.value}px` };
  return { top: `${arrowOffset.value}px` };
});

function onResize() { measure(); }
function onKey(e: KeyboardEvent) {
  if (!active.value) return;
  if (e.key === 'ArrowRight') { e.preventDefault(); next(); }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); prev(); }
  else if (e.key === 'Escape') { e.preventDefault(); skip(); }
}

watch(() => stepIndex.value, () => locate());
watch(() => active.value, (v) => { if (v) locate(); });

onMounted(() => {
  window.addEventListener('resize', onResize);
  window.addEventListener('scroll', onResize, true);
  window.addEventListener('keydown', onKey);
  if (active.value) locate();
});
onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize);
  window.removeEventListener('scroll', onResize, true);
  window.removeEventListener('keydown', onKey);
});
</script>

<style scoped>
.tour-root { position: fixed; inset: 0; z-index: 9000; }
.tour-dim { position: fixed; inset: 0; background: rgba(10,10,11,0.55); cursor: pointer; animation: tourFade .25s ease; }
.tour-spotlight { position: fixed; border-radius: 14px; cursor: pointer; transition: all .32s cubic-bezier(.16,1,.3,1); animation: tourFade .25s ease; }
@keyframes tourFade { from { opacity: 0; } to { opacity: 1; } }

.tour-ring {
  position: fixed; border-radius: 14px; pointer-events: none;
  box-shadow: 0 0 0 1.5px var(--signal-bright), 0 0 0 6px var(--signal-soft);
  transition: all .32s cubic-bezier(.16,1,.3,1);
  animation: tourPulse 2.4s ease-in-out infinite;
}
@keyframes tourPulse {
  0%,100% { box-shadow: 0 0 0 1.5px var(--signal-bright), 0 0 0 6px color-mix(in srgb, var(--signal-soft) 70%, transparent); }
  50% { box-shadow: 0 0 0 1.5px var(--signal-bright), 0 0 0 10px color-mix(in srgb, var(--signal-soft) 30%, transparent); }
}

.tour-card {
  position: fixed; background: var(--paper); border: 1px solid var(--rule);
  border-radius: var(--radius-lg); box-shadow: var(--shadow-pop);
  padding: 20px 20px 16px; z-index: 9001;
  transition: left .32s cubic-bezier(.16,1,.3,1), top .32s cubic-bezier(.16,1,.3,1);
  animation: tourCardIn .3s cubic-bezier(.16,1,.3,1);
}
@keyframes tourCardIn { from { opacity: 0; transform: scale(.96) translateY(6px); } to { opacity: 1; transform: scale(1) translateY(0); } }
.tour-centered .tour-card { animation: tourCardInBig .34s cubic-bezier(.16,1,.3,1); }
@keyframes tourCardInBig { from { opacity: 0; transform: scale(.94); } to { opacity: 1; transform: scale(1); } }

/* arrow */
.tour-arrow { position: absolute; width: 14px; height: 14px; background: var(--paper); border: 1px solid var(--rule); transform: rotate(45deg); }
.arrow-bottom { top: -8px; border-right: none; border-bottom: none; }
.arrow-top { bottom: -8px; border-left: none; border-top: none; }
.arrow-right { left: -8px; border-right: none; border-top: none; }
.arrow-left { right: -8px; border-left: none; border-bottom: none; }

.tour-card-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
.tour-step-label { font-family: var(--font-mono); font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: var(--signal); font-weight: 600; }
.tour-step-of { color: var(--ink-mute); font-weight: 500; }
.tour-x { width: 26px; height: 26px; display: flex; align-items: center; justify-content: center; border-radius: var(--radius-sm); color: var(--ink-mute); transition: background .12s, color .12s; }
.tour-x:hover { background: var(--paper-2); color: var(--ink); }

.tour-title { font-family: var(--font-display); font-size: 21px; line-height: 1.2; color: var(--ink); margin: 0 0 7px; letter-spacing: -.01em; }
.tour-body { font-size: 13.5px; line-height: 1.6; color: var(--ink-soft); margin: 0 0 18px; }

.tour-foot { display: flex; align-items: center; justify-content: space-between; gap: 14px; }
.tour-dots { display: flex; gap: 6px; }
.tour-dot { width: 7px; height: 7px; border-radius: 999px; background: var(--rule); transition: all .2s; }
.tour-dot.done { background: var(--signal-soft); }
.tour-dot.on { background: var(--signal); width: 18px; }
.tour-actions { display: flex; gap: 8px; }
.tour-btn { font-size: 13px; font-weight: 500; padding: 8px 16px; border-radius: 999px; transition: background .12s, border-color .12s, transform .08s; }
.tour-btn:active { transform: translateY(1px); }
.tour-btn.ghost { color: var(--ink-soft); border: 1px solid var(--rule); background: transparent; }
.tour-btn.ghost:hover { background: var(--paper-2); color: var(--ink); }
.tour-btn.primary { background: var(--signal); color: #fff; border: 1px solid var(--signal); }
.tour-btn.primary:hover { background: var(--signal-2); }
</style>
