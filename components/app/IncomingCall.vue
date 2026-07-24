<template>
  <!-- Incoming call banner: slides in when a call arrives, regardless of page. -->
  <transition name="ring-slide">
    <div v-if="voice.incoming.value" class="incoming">
      <div class="incoming-pulse" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/>
        </svg>
      </div>
      <div class="incoming-text">
        <div class="incoming-label">Incoming call</div>
        <div class="incoming-from">{{ voice.incomingFrom.value || 'Unknown caller' }}</div>
      </div>
      <div class="incoming-actions">
        <button class="ic-btn ic-decline" title="Decline" @click="voice.rejectIncoming()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
        <button class="ic-btn ic-accept" title="Answer" @click="voice.acceptIncoming()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
        </button>
      </div>
    </div>
  </transition>

  <!-- Active inbound call: stays until the user hangs up. -->
  <transition name="ring-slide">
    <div v-if="onCall" class="incoming oncall">
      <div class="oncall-dot" aria-hidden="true"></div>
      <div class="incoming-text">
        <div class="incoming-label">On call</div>
        <div class="incoming-from">{{ activeFrom || 'Connected' }} · {{ durStr }}</div>
      </div>
      <div class="incoming-actions">
        <button class="ic-btn ic-mute" :class="{ 'is-muted': voice.muted.value }" :title="voice.muted.value ? 'Unmute' : 'Mute'" @click="voice.toggleMute()">
          <svg v-if="!voice.muted.value" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/></svg>
          <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="1" y1="1" x2="23" y2="23"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"/><line x1="12" y1="19" x2="12" y2="23"/></svg>
        </button>
        <button class="ic-btn ic-decline" title="Hang up" @click="endActive()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="transform: rotate(135deg)"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
        </button>
      </div>
    </div>
  </transition>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';

// Which token endpoint registers this browser to receive calls. Clients use
// their own workspace's; admins pass the support one so support calls ring them.
const props = withDefaults(defineProps<{ tokenEndpoint?: string }>(), {
  tokenEndpoint: '/api/voice/token'
});

const voice = useVoiceCall();
const ringtone = useRingtone();
const callActive = useCallActive();

const onCall = computed(() => voice.state.value === 'in_call');
const activeFrom = ref('');
const elapsed = ref(0);
let timer: any = null;

const durStr = computed(() => {
  const m = Math.floor(elapsed.value / 60);
  const s = elapsed.value % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
});

watch(() => voice.incoming.value, (isRinging) => {
  if (isRinging) { ringtone.start(); callActive.value = true; }
  else { ringtone.stop(); if (voice.state.value !== 'in_call') callActive.value = false; }
});

watch(() => voice.state.value, (st) => {
  if (st === 'in_call') {
    callActive.value = true;
    activeFrom.value = voice.incomingFrom.value || '';
    elapsed.value = 0;
    if (timer) clearInterval(timer);
    timer = setInterval(() => { elapsed.value += 1; }, 1000);
  } else {
    if (timer) { clearInterval(timer); timer = null; }
    if (!voice.incoming.value) callActive.value = false;
  }
});

function endActive() {
  voice.hangup();
}

onMounted(async () => {
  if (!import.meta.client) return;
  try { await voice.startReceiving({ tokenEndpoint: props.tokenEndpoint }); } catch { /* optional */ }
});

onUnmounted(() => {
  if (timer) clearInterval(timer);
  try { voice.stopReceiving(); } catch { /* */ }
});
</script>

<style scoped>
.incoming {
  position: fixed; z-index: 240; right: 24px; bottom: 24px;
  display: flex; align-items: center; gap: 14px;
  width: min(360px, calc(100vw - 32px));
  padding: 14px 16px;
  background: var(--paper); border: 1px solid var(--rule);
  border-radius: var(--radius-lg); box-shadow: var(--shadow-pop);
}
.incoming-pulse {
  flex: none; width: 44px; height: 44px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  background: var(--signal-soft); color: var(--signal); position: relative;
}
.incoming-pulse svg { width: 20px; height: 20px; }
.incoming-pulse::after {
  content: ''; position: absolute; inset: 0; border-radius: 50%;
  border: 2px solid var(--signal); opacity: 0;
  animation: icRing 1.8s ease-out infinite;
}
@keyframes icRing { 0% { transform: scale(1); opacity: 0.6; } 100% { transform: scale(1.5); opacity: 0; } }
.incoming-text { flex: 1; min-width: 0; }
.incoming-label { font-size: 11.5px; letter-spacing: 0.04em; text-transform: uppercase; color: var(--ink-mute); }
.incoming-from { font-size: 16px; color: var(--ink); font-family: var(--font-mono); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.incoming-actions { display: flex; gap: 10px; flex: none; }
.ic-btn { display: flex; align-items: center; justify-content: center; width: 44px; height: 44px; border-radius: 50%; color: #fff; transition: filter 0.12s; }
.ic-btn:hover { filter: brightness(0.95); }
.ic-btn svg { width: 20px; height: 20px; }
.ic-mute { background: var(--paper-2); color: var(--ink-soft); border: 1px solid var(--rule); }
.ic-mute:hover { background: var(--paper-3); }
.ic-mute.is-muted { background: var(--danger); color: #fff; border-color: var(--danger); }
.ic-accept { background: var(--live); }
.ic-decline { background: var(--danger); }

.oncall { border-color: var(--live); }
.oncall-dot {
  flex: none; width: 12px; height: 12px; margin: 0 6px 0 2px; border-radius: 50%;
  background: var(--live); box-shadow: 0 0 0 0 rgba(0,210,138,0.5);
  animation: liveDot 1.6s ease-out infinite;
}
@keyframes liveDot { 0% { box-shadow: 0 0 0 0 rgba(0,210,138,0.45); } 100% { box-shadow: 0 0 0 8px rgba(0,210,138,0); } }

.ring-slide-enter-active, .ring-slide-leave-active { transition: transform 0.22s ease, opacity 0.22s ease; }
.ring-slide-enter-from, .ring-slide-leave-to { transform: translateY(12px); opacity: 0; }

@media (prefers-reduced-motion: reduce) {
  .incoming-pulse::after { animation: none; }
  .ring-slide-enter-active, .ring-slide-leave-active { transition: opacity 0.15s ease; }
  .ring-slide-enter-from, .ring-slide-leave-to { transform: none; }
}
</style>
