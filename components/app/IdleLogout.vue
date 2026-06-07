<template>
  <div v-if="warning" class="idle-overlay">
    <div class="idle-modal">
      <h3 class="idle-title">Still there?</h3>
      <p class="idle-text">You've been inactive for a while. For your security, we'll sign you out in <strong>{{ countdown }}s</strong>.</p>
      <div class="idle-actions">
        <button class="btn btn-signal" @click="stayActive">Stay signed in</button>
        <button class="btn btn-ghost" @click="logoutNow">Log out now</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { useAuthStore } from '~/stores/auth';

// Inactivity auto-logout. Defaults: sign out after 5 minutes idle, warn 60s
// before. Activity (mouse/keyboard/scroll/touch/visibility) resets the timer.
// Durations are props so they can be tuned without code changes.
const props = withDefaults(defineProps<{ idleMs?: number; warnMs?: number; mode?: 'client' | 'admin' }>(), {
  idleMs: 5 * 60 * 1000, // 5 minutes
  warnMs: 60 * 1000,     // warn 60s before logout
  mode: 'client'
});

const auth = useAuthStore();
const warning = ref(false);
const countdown = ref(Math.round(props.warnMs / 1000));

let idleTimer: ReturnType<typeof setTimeout> | null = null;
let warnTimer: ReturnType<typeof setTimeout> | null = null;
let tick: ReturnType<typeof setInterval> | null = null;
let lastReset = 0;

function clearTimers() {
  if (idleTimer) clearTimeout(idleTimer);
  if (warnTimer) clearTimeout(warnTimer);
  if (tick) clearInterval(tick);
  idleTimer = warnTimer = tick = null;
}

function startTimers() {
  clearTimers();
  // Show the warning at (idle - warn); log out at idle.
  const warnAt = Math.max(props.idleMs - props.warnMs, 0);
  warnTimer = setTimeout(showWarning, warnAt);
  idleTimer = setTimeout(logoutNow, props.idleMs);
}

function showWarning() {
  warning.value = true;
  countdown.value = Math.round(props.warnMs / 1000);
  tick = setInterval(() => {
    countdown.value -= 1;
    if (countdown.value <= 0 && tick) clearInterval(tick);
  }, 1000);
}

function resetIdle() {
  // Throttle resets so we don't reschedule on every mousemove pixel.
  const now = Date.now();
  if (warning.value) return;            // while warned, only explicit action resets
  if (now - lastReset < 1000) return;   // at most once per second
  lastReset = now;
  startTimers();
}

function stayActive() {
  warning.value = false;
  startTimers();
}

async function logoutNow() {
  clearTimers();
  warning.value = false;
  if (props.mode === 'admin') {
    // Admin uses a separate session + login page.
    try { await $fetch('/api/admin/logout', { method: 'POST' }); } catch { /* navigate anyway */ }
    await navigateTo('/admin/login');
    return;
  }
  try { await auth.logout(); } catch { /* navigate anyway */ }
}

const ACTIVITY = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'click'];
function onVisibility() { if (document.visibilityState === 'visible') resetIdle(); }

onMounted(() => {
  if (!import.meta.client) return;
  ACTIVITY.forEach((e) => window.addEventListener(e, resetIdle, { passive: true }));
  document.addEventListener('visibilitychange', onVisibility);
  startTimers();
});

onUnmounted(() => {
  if (!import.meta.client) return;
  ACTIVITY.forEach((e) => window.removeEventListener(e, resetIdle));
  document.removeEventListener('visibilitychange', onVisibility);
  clearTimers();
});
</script>

<style scoped>
.idle-overlay { position: fixed; inset: 0; z-index: 400; background: rgba(10,10,11,0.45); display: flex; align-items: center; justify-content: center; padding: 24px; }
.idle-modal { background: var(--paper); border: 1px solid var(--rule); border-radius: var(--radius-lg); padding: 28px; max-width: 380px; width: 100%; box-shadow: var(--shadow-pop); }
.idle-title { font-family: var(--font-display); font-size: 20px; color: var(--ink); margin: 0 0 8px; }
.idle-text { font-size: 14px; color: var(--ink-soft); line-height: 1.55; margin: 0 0 20px; }
.idle-actions { display: flex; gap: 10px; }
</style>
