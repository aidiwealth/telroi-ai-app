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
</template>

<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue';
const voice = useVoiceCall();
onMounted(async () => {
  if (!import.meta.client) return;
  try { await voice.startReceiving({ tokenEndpoint: '/api/voice/token' }); } catch { /* optional */ }
});
onUnmounted(() => { try { voice.stopReceiving(); } catch { /* */ } });
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
.ic-accept { background: var(--live); }
.ic-decline { background: var(--danger); }
.ring-slide-enter-active, .ring-slide-leave-active { transition: transform 0.22s ease, opacity 0.22s ease; }
.ring-slide-enter-from, .ring-slide-leave-to { transform: translateY(12px); opacity: 0; }
@media (prefers-reduced-motion: reduce) {
  .incoming-pulse::after { animation: none; }
  .ring-slide-enter-active, .ring-slide-leave-active { transition: opacity 0.15s ease; }
  .ring-slide-enter-from, .ring-slide-leave-to { transform: none; }
}
</style>
