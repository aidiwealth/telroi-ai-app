<template>
  <Transition name="drawer">
    <div v-if="call" class="drawer-overlay" @click.self="$emit('close')">
      <aside class="drawer">
        <div class="drawer-head">
          <span class="chip" :class="call.type === 'in' ? 'chip--in' : 'chip--out'">{{ call.type === 'in' ? 'Inbound' : 'Outbound' }}</span>
          <button class="modal-x" @click="$emit('close')">✕</button>
        </div>
        <h2 class="drawer-num mono">{{ call.client }}</h2>
        <p class="drawer-when">{{ fmtTime(call.start) }}</p>

        <dl class="drawer-dl">
          <div><dt>Status</dt><dd><span class="chip" :class="statusChip(call.status)">{{ call.status }}</span></dd></div>
          <div><dt>Agent</dt><dd>{{ call.user_name || '—' }}</dd></div>
          <div><dt>Department</dt><dd>{{ call.group_name || '—' }}</dd></div>
          <div><dt>Routed to</dt><dd class="mono">{{ call.diversion || '—' }}</dd></div>
          <div><dt>Wait</dt><dd class="mono">{{ call.wait ? call.wait + 's' : '—' }}</dd></div>
          <div><dt>Duration</dt><dd class="mono">{{ fmtDur(call.duration) }}</dd></div>
        </dl>

        <div class="drawer-rate">
          <div class="drawer-sub">Rate this call</div>
          <div class="rate-stars" :class="{ saving: saving }">
            <button v-for="n in 5" :key="n" class="rate-star" :class="{ on: n <= (call.rating || 0) }"
              @click="setRating(n)" :disabled="saving" :aria-label="`${n} star`">★</button>
            <button v-if="call.rating" class="rate-clear" @click="setRating(null)" :disabled="saving">Clear</button>
          </div>
          <textarea v-model="noteDraft" class="rate-note" rows="2" placeholder="Add a note about this call (optional)"></textarea>
          <button class="btn btn-ghost btn-sm" :disabled="saving" @click="saveNote">{{ saving ? 'Saving…' : 'Save note' }}</button>
        </div>

        <div class="drawer-rec">
          <div class="drawer-sub">Recording</div>
          <template v-if="call.record">
            <audio controls :src="call.record" class="drawer-audio" />
            <a :href="call.record" :download="`call-${call.uid}.mp3`" class="rec-download">Download recording</a>
          </template>
          <p v-else class="rec-none">No recording available for this call.</p>
        </div>

        <div class="drawer-actions">
          <button class="btn btn-signal btn-block" @click="callBack">Call back</button>
        </div>
      </aside>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import type { TelroiCall } from '~/server/utils/telroi/client';

const props = defineProps<{ call: TelroiCall | null }>();
const emit = defineEmits<{ close: []; updated: [call: TelroiCall]; callback: [phone: string] }>();

const api = useApi();
const toast = useToast();
const saving = ref(false);
const noteDraft = ref('');
watch(() => props.call, (c) => { noteDraft.value = (c?.note as string) || ''; });

async function setRating(rating: number | null) {
  if (!props.call) return;
  saving.value = true;
  try {
    await api.post('/api/voice/calls/rating', { callUid: props.call.uid, rating });
    props.call.rating = rating ?? undefined;
    emit('updated', props.call);
    toast.ok(rating ? 'Rating saved' : 'Rating cleared');
  } catch (e: any) { toast.err(e?.data?.error?.message || 'Could not save rating'); }
  finally { saving.value = false; }
}
async function saveNote() {
  if (!props.call) return;
  saving.value = true;
  try {
    await api.post('/api/voice/calls/rating', { callUid: props.call.uid, note: noteDraft.value });
    props.call.note = noteDraft.value;
    emit('updated', props.call);
    toast.ok('Note saved');
  } catch (e: any) { toast.err(e?.data?.error?.message || 'Could not save note'); }
  finally { saving.value = false; }
}
async function callBack() {
  if (!props.call) return;
  // Open the dialer in its ringing flow (parent owns the dialer), pre-filled
  // with this caller's number — same UX as dialing manually.
  emit('callback', props.call.client);
  emit('close');
}

function fmtTime(s: string) { return s ? new Date(s).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'; }
function fmtDur(d: number) { if (!d) return '—'; const m = Math.floor(d / 60), sec = d % 60; return m ? `${m}m ${sec}s` : `${sec}s`; }
function statusChip(status: string) {
  const s = (status || '').toLowerCase();
  if (s.includes('answer') || s.includes('success')) return 'chip--ok';
  if (s.includes('miss') || s.includes('fail') || s.includes('busy') || s.includes('no ')) return 'chip--bad';
  return 'chip--neutral';
}
</script>

<style scoped>
.drawer-overlay { position: fixed; inset: 0; z-index: 150; background: rgba(10,10,11,0.28); display: flex; justify-content: flex-end; }
.drawer { width: 420px; max-width: 92vw; background: var(--paper); height: 100%; padding: 28px; overflow-y: auto; box-shadow: var(--shadow-pop); }
.drawer-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 18px; }
.modal-x { color: var(--ink-mute); font-size: 14px; }
.drawer-num { font-family: var(--font-display); font-size: 28px; letter-spacing: -0.01em; }
.drawer-when { color: var(--ink-soft); font-size: 13.5px; margin-bottom: 24px; }
.drawer-dl { display: flex; flex-direction: column; gap: 0; }
.drawer-dl > div { display: flex; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid var(--rule-2); }
.drawer-dl dt { color: var(--ink-soft); font-size: 13px; }
.drawer-dl dd { font-size: 14px; }
.drawer-sub { font-family: var(--font-mono); font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--ink-soft); margin-bottom: 10px; }
.drawer-rate { margin-top: 22px; }
.rate-stars { display: flex; align-items: center; gap: 4px; margin-bottom: 10px; }
.rate-stars.saving { opacity: 0.6; }
.rate-star { font-size: 24px; line-height: 1; color: var(--rule); transition: color 0.1s; }
.rate-star.on, .rate-star:hover:not(:disabled) { color: var(--warn); }
.rate-clear { margin-left: 10px; font-size: 12px; color: var(--ink-mute); }
.rate-clear:hover { color: var(--ink); }
.rate-note { width: 100%; padding: 9px 11px; border: 1px solid var(--rule); border-radius: var(--radius); font-size: 13.5px; background: var(--paper); color: var(--ink); resize: vertical; margin-bottom: 8px; outline: none; font-family: inherit; }
.drawer-rec { margin-top: 22px; }
.drawer-audio { width: 100%; }
.rec-download { display: inline-block; margin-top: 8px; font-size: 13px; color: var(--signal); }
.rec-none { font-size: 13px; color: var(--ink-mute); }
.drawer-actions { margin-top: 26px; }
.drawer-enter-active, .drawer-leave-active { transition: opacity .2s; }
.drawer-enter-active .drawer, .drawer-leave-active .drawer { transition: transform .25s var(--motion-ease); }
.drawer-enter-from, .drawer-leave-to { opacity: 0; }
.drawer-enter-from .drawer, .drawer-leave-to .drawer { transform: translateX(40px); }
</style>
