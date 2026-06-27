<template>
  <div class="modal-overlay" @click.self="onOverlayClose">
    <div class="dialer">
      <button class="dialer-x" @click="onOverlayClose" aria-label="Close">✕</button>

      <!-- IDLE: dial pad -->
      <template v-if="phase === 'idle'">
        <div class="dialer-display">
          <input v-model="phone" class="dialer-num" placeholder="Enter a number" inputmode="tel" />
          <button v-if="phone" class="dialer-back" @click="backspace" aria-label="Delete">⌫</button>
        </div>
        <div class="dialer-from">
          <label>Call from</label>
          <select v-if="ownedNumbers.length" v-model="from" class="select">
            <option v-for="n in ownedNumbers" :key="n.telnum" :value="n.telnum">{{ n.telnum }} · {{ n.region }}</option>
          </select>
          <span v-else class="dialer-nonum">No approved numbers yet — buy one to place calls.</span>
        </div>
        <div class="dialpad">
          <button v-for="k in keys" :key="k.d" class="dialkey" @click="press(k.d)">
            <span class="dialkey-d">{{ k.d }}</span>
            <span class="dialkey-l">{{ k.l }}</span>
          </button>
        </div>
        <button class="dialer-call" :disabled="!phone || !from || busy" @click="startCall">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C10.7 21 3 13.3 3 3.9c0-.6.5-1 1-1h3.5c.6 0 1 .4 1 1 0 1.2.2 2.4.6 3.6.1.4 0 .7-.2 1l-2.3 2.3z"/></svg>
          Call
        </button>
        <p class="dialer-hint">Telroi rings your phone first, then connects the other party.</p>
      </template>

      <!-- CALLING / RINGING / IN-CALL -->
      <template v-else-if="phase === 'calling' || phase === 'in_call'">
        <div class="call-live">
          <div class="call-avatar" :class="{ ringing: phase === 'calling' }">
            <span>{{ initials }}</span>
            <span v-if="phase === 'calling'" class="ring-pulse"></span>
            <span v-if="phase === 'calling'" class="ring-pulse delay"></span>
          </div>
          <div class="call-num mono">{{ phone }}</div>
          <div class="call-state">
            <span v-if="phase === 'calling'">{{ ringText }}</span>
            <span v-else class="call-timer mono">{{ durStr }}</span>
          </div>
          <p v-if="phase === 'calling'" class="call-sub">Your phone rings first — answer it to connect.</p>
        </div>
        <button class="dialer-end" @click="endCall">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 9c-1.6 0-3.15.25-4.6.7v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08a.996.996 0 0 1-.29-.7c0-.28.11-.53.29-.71C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67c.18.18.29.43.29.71 0 .28-.11.53-.29.71l-1.48 1.86c-.18.18-.43.29-.71.29-.27 0-.52-.11-.7-.28a11.27 11.27 0 0 0-2.66-1.85.998.998 0 0 1-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z"/></svg>
          End call
        </button>
      </template>

      <!-- ENDED -->
      <template v-else>
        <div class="call-live">
          <div class="call-avatar ended"><span>✓</span></div>
          <div class="call-num mono">{{ phone }}</div>
          <div class="call-state">Call ended<span v-if="lastDur"> · {{ durStr }}</span></div>
        </div>
        <div class="ended-actions">
          <button class="btn btn-ghost btn-block" @click="reset">New call</button>
          <button class="btn btn-signal btn-block" @click="$emit('close')">Done</button>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';

const props = defineProps<{ initialPhone?: string; autoStart?: boolean; initialFrom?: string; tokenEndpoint?: string; numbersEndpoint?: string }>();
const emit = defineEmits<{ close: [] }>();
const api = useApi();
const toast = useToast();
const voice = useVoiceCall();

// Map the real voice-call state onto the dialer's phase + handle billing on end.
watch(voice.state, (st) => {
  if (st === 'acquiring_mic' || st === 'connecting' || st === 'ringing') phase.value = 'calling';
  else if (st === 'in_call') { if (phase.value !== 'in_call') { stopRinging(); phase.value = 'in_call'; startDuration(); } }
  else if (st === 'error') { stopRinging(); phase.value = 'idle'; toast.err(voice.error.value || 'Call failed'); }
});

type Phase = 'idle' | 'calling' | 'in_call' | 'ended';
const phase = ref<Phase>('idle');
const phone = ref(props.initialPhone || '');
const from = ref(props.initialFrom || '');
const busy = ref(false);
const ownedNumbers = ref<any[]>([]);
const callid = ref('');

const keys = [
  { d: '1', l: '' }, { d: '2', l: 'ABC' }, { d: '3', l: 'DEF' },
  { d: '4', l: 'GHI' }, { d: '5', l: 'JKL' }, { d: '6', l: 'MNO' },
  { d: '7', l: 'PQRS' }, { d: '8', l: 'TUV' }, { d: '9', l: 'WXYZ' },
  { d: '*', l: '' }, { d: '0', l: '+' }, { d: '#', l: '' }
];

const initials = computed(() => (phone.value || '?').replace(/[^\d+]/g, '').slice(-2) || '#');

// Ringing animation text
const ringDots = ref(0);
const ringText = computed(() => 'Ringing' + '.'.repeat(ringDots.value));
let ringTimer: ReturnType<typeof setInterval> | null = null;

// In-call duration
const seconds = ref(0);
const lastDur = ref(0);
let durTimer: ReturnType<typeof setInterval> | null = null;
const durStr = computed(() => {
  const s = phase.value === 'ended' ? lastDur.value : seconds.value;
  const m = Math.floor(s / 60); const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, '0')}`;
});

function press(d: string) {
  // 0 long-press would be +, but a simple tap appends the digit; '+' via 0 label hint.
  phone.value += d;
}
function backspace() { phone.value = phone.value.slice(0, -1); }

function startRinging() {
  ringDots.value = 0;
  ringTimer = setInterval(() => { ringDots.value = (ringDots.value + 1) % 4; }, 500);
}
function stopRinging() { if (ringTimer) { clearInterval(ringTimer); ringTimer = null; } }
function startDuration() {
  seconds.value = 0;
  durTimer = setInterval(() => { seconds.value += 1; }, 1000);
}
function stopDuration() { if (durTimer) { clearInterval(durTimer); durTimer = null; } }

async function startCall() {
  if (!phone.value) return;
  busy.value = true;
  phase.value = 'calling';
  startRinging();
  callid.value = 'dial_' + Date.now();
  try {
    await voice.startCall({
      to: phone.value,
      from: from.value,
      tokenEndpoint: props.tokenEndpoint || '/api/voice/token',
      onEnd: async (secs) => {
        stopRinging(); stopDuration();
        lastDur.value = secs || seconds.value;
        phase.value = 'ended';
        // Meter + charge the completed call to the wallet.
        try { await api.post('/api/voice/charge', { callId: callid.value, seconds: secs || 0 }); } catch { /* */ }
      }
    });
  } catch (e: any) {
    stopRinging();
    phase.value = 'idle';
    toast.err(voice.error.value || e?.message || 'Could not place the call');
  } finally {
    busy.value = false;
  }
}

function endCall() {
  // Hang up the real call leg; billing fires via the voice onEnd callback.
  voice.hangup();
  stopRinging();
  stopDuration();
  lastDur.value = seconds.value;
  phase.value = 'ended';
}

function reset() {
  phase.value = 'idle';
  seconds.value = 0; lastDur.value = 0; callid.value = '';
}

function onOverlayClose() {
  // Don't let an accidental backdrop click kill an active call view.
  if (phase.value === 'calling' || phase.value === 'in_call') return;
  emit('close');
}

onMounted(async () => {
  try {
    const ep = props.numbersEndpoint || '/api/numbers/subscriptions';
    const raw = await api.get<any>(ep);
    // Client endpoint returns an array; admin endpoint returns { numbers: [...] }.
    const list = Array.isArray(raw) ? raw : (raw?.numbers || []);
    ownedNumbers.value = list.filter((n: any) => n.status === 'active');
    // Default to the first approved number unless one was passed in.
    if (!from.value && ownedNumbers.value.length) from.value = ownedNumbers.value[0].telnum;
  }
  catch { /* */ }
  if (props.autoStart && props.initialPhone) startCall();
});
onUnmounted(() => { stopRinging(); stopDuration(); });
</script>

<style scoped>
.modal-overlay { position: fixed; inset: 0; z-index: 200; background: rgba(10,10,11,0.45); display: flex; align-items: center; justify-content: center; padding: 24px; }
.dialer { position: relative; width: 100%; max-width: 360px; background: var(--paper); border: 1px solid var(--rule); border-radius: var(--radius-lg); padding: 22px; box-shadow: var(--shadow-pop); }
.dialer-x { position: absolute; top: 14px; right: 14px; color: var(--ink-mute); font-size: 14px; }

.dialer-display { display: flex; align-items: center; gap: 8px; margin: 6px 0 14px; }
.dialer-num { flex: 1; font-family: var(--font-mono); font-size: 24px; text-align: center; border: none; outline: none; background: transparent; color: var(--ink); letter-spacing: 0.02em; }
.dialer-back { color: var(--ink-mute); font-size: 18px; padding: 4px; }
.dialer-from { display: flex; align-items: center; gap: 8px; margin-bottom: 16px; }
.dialer-from label { font-size: 12px; color: var(--ink-soft); white-space: nowrap; }
.dialer-from .select { flex: 1; }
.dialer-nonum { flex: 1; font-size: 12px; color: var(--warn); }

.dialpad { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 18px; }
.dialkey { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 54px; border-radius: 14px; background: var(--paper-2); border: 1px solid var(--rule); transition: background 0.1s, border-color 0.1s; }
.dialkey:hover { background: var(--paper-3); border-color: var(--ink-soft); }
.dialkey:active { background: var(--signal-soft); border-color: var(--signal); }
.dialkey-d { font-size: 22px; font-weight: 500; color: var(--ink); line-height: 1; }
.dialkey-l { font-size: 8.5px; letter-spacing: 0.12em; color: var(--ink-mute); margin-top: 2px; min-height: 10px; }

.dialer-call, .dialer-end { display: flex; align-items: center; justify-content: center; gap: 8px; width: 100%; height: 50px; border-radius: 999px; font-size: 15px; font-weight: 600; color: #fff; transition: filter 0.12s, opacity 0.12s; }
.dialer-call { background: var(--live); }
.dialer-call:hover:not(:disabled) { filter: brightness(0.95); }
.dialer-call:disabled { opacity: 0.5; }
.dialer-call svg { width: 20px; height: 20px; }
.dialer-end { background: var(--danger); margin-top: 8px; }
.dialer-end:hover { filter: brightness(0.95); }
.dialer-end svg { width: 22px; height: 22px; transform: rotate(135deg); }
.dialer-hint { font-size: 11.5px; color: var(--ink-mute); text-align: center; margin: 12px 0 0; line-height: 1.5; }

/* Live call view */
.call-live { display: flex; flex-direction: column; align-items: center; padding: 18px 0 26px; }
.call-avatar { position: relative; width: 92px; height: 92px; border-radius: 50%; background: var(--signal-soft); color: var(--signal); display: flex; align-items: center; justify-content: center; font-size: 28px; font-weight: 600; margin-bottom: 22px; }
.call-avatar.ended { background: rgba(0,210,138,0.14); color: var(--live); }
.ring-pulse { position: absolute; inset: 0; border-radius: 50%; border: 2px solid var(--signal); opacity: 0; animation: ringPulse 1.8s ease-out infinite; }
.ring-pulse.delay { animation-delay: 0.9s; }
@keyframes ringPulse { 0% { transform: scale(1); opacity: 0.6; } 100% { transform: scale(1.5); opacity: 0; } }
.call-num { font-size: 22px; color: var(--ink); margin-bottom: 8px; }
.call-state { font-size: 15px; color: var(--ink-soft); min-height: 22px; }
.call-timer { color: var(--live); font-size: 18px; }
.call-sub { font-size: 12px; color: var(--ink-mute); margin: 12px 0 0; text-align: center; }
.ended-actions { display: flex; gap: 10px; }
</style>
