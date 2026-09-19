<template>
  <Transition name="drawer">
    <div v-if="call" class="drawer-overlay" @click.self="$emit('close')">
      <aside class="drawer">
        <div class="drawer-head">
          <span class="chip" :class="call.type === 'in' ? 'chip--in' : 'chip--out'">{{ call.type === 'in' ? 'Inbound' : 'Outbound' }}</span>
          <button class="modal-x" @click="$emit('close')">✕</button>
        </div>
        <h2 class="drawer-num mono">{{ call.client }}</h2>
        <!-- Who the number belongs to, when the CRM knows. A call log answers
             "when" and "how long" perfectly well and never answered "who" —
             which is the first thing anybody looking at one wants. Absent for
             an unknown number rather than showing an empty panel. -->
        <div v-if="contact" class="drawer-who">
          <NuxtLink :to="`/crm?contact=${contact.id}`" class="drawer-who-name">{{ contact.name || 'Unnamed contact' }}</NuxtLink>
          <span v-if="contact.company" class="drawer-who-co">{{ contact.company }}</span>
          <div v-if="contact.tags?.length" class="drawer-who-tags">
            <span v-for="t in contact.tags" :key="t.id" class="crm-tag">{{ t.name }}</span>
          </div>
        </div>
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

        <div v-if="recordingId" class="drawer-rec">
          <div class="drawer-sub">Recording</div>
          <audio controls preload="none" :src="`/api/voice/recordings/${recordingId}/audio`" class="drawer-audio" />
          <a :href="`/api/voice/recordings/${recordingId}/audio`" :download="`call-${call.uid}.wav`" class="rec-download">Download</a>

          <!-- The transcript outlives the audio, so this is worth doing before
               retention runs out rather than after. -->
          <div class="tr-block">
            <div v-if="transcript" class="tr-text">{{ transcript }}</div>
            <template v-else>
              <button class="btn btn-ghost btn-sm" :disabled="transcribing" @click="transcribe">
                {{ transcribing ? 'Transcribing…' : 'Transcribe this call' }}
              </button>
              <p class="tr-note muted">
                Charged by length, from your wallet. The text is kept even after the recording expires.
              </p>
              <p v-if="trErr" class="tr-err">{{ trErr }}</p>
            </template>
          </div>
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
// Looked up per call rather than carried on it: a contact can be renamed or
// tagged after the call happened, and the log should show who they are now.
const contact = ref<any>(null);
async function loadContact(phone?: string) {
  contact.value = null;
  if (!phone) return;
  try {
    const r = await $fetch<any>('/api/crm/lookup', { query: { phone } });
    contact.value = r?.contact || null;
  } catch { /* an unknown caller is not an error */ }
}
import type { TelroiCall } from '~/server/utils/telroi/client';

const props = defineProps<{ call: TelroiCall | null; recordingId?: string | null }>();
const emit = defineEmits<{ close: []; updated: [call: TelroiCall]; callback: [phone: string] }>();

const api = useApi();

// The transcript, if there is one. Fetched when the drawer opens rather than
// left to a button, so a call already transcribed shows its text instead of
// asking somebody to press a paid action to find out.
const transcript = ref<string | null>(null);
const transcribing = ref(false);
const trErr = ref('');

watch(() => props.recordingId, async (id) => {
  transcript.value = null; trErr.value = '';
  if (!id) return;
  try {
    const r = await api.get<any>(`/api/voice/recordings/${id}`);
    transcript.value = r?.recording?.transcript || null;
  } catch { /* no transcript yet, which is the ordinary case */ }
}, { immediate: true });

async function transcribe() {
  if (!props.recordingId) return;
  transcribing.value = true; trErr.value = '';
  try {
    const r = await api.post<any>(`/api/voice/recordings/${props.recordingId}/transcribe`, {});
    if (r.transcript) { transcript.value = r.transcript; return; }
    // The endpoint returns as soon as the work starts, so this waits for it.
    // Transcription takes as long as the audio is long, roughly, and a request
    // held open that long is one the gateway closes.
    await pollTranscript();
  } catch (e: any) {
    trErr.value = e?.data?.error?.message || 'That recording could not be transcribed.';
  } finally { transcribing.value = false; }
}

/** Waits for the background work, and gives up rather than polling forever —
 *  a spinner with no end is worse than a message saying to come back. */
async function pollTranscript() {
  const id = props.recordingId;
  for (let i = 0; i < 40; i++) {                      // ~2 minutes
    await new Promise((r) => setTimeout(r, 3000));
    if (props.recordingId !== id) return;             // they moved to another call
    try {
      const r = await api.get<any>(`/api/voice/recordings/${id}`);
      if (r?.recording?.transcript) { transcript.value = r.recording.transcript; return; }
      if (r?.recording?.transcriptStatus === 'failed') {
        trErr.value = 'There was no clear speech in that recording.';
        return;
      }
    } catch { /* keep waiting */ }
  }
  trErr.value = 'Still working on it — check back in a minute.';
}
const toast = useToast();
const saving = ref(false);
const noteDraft = ref('');
watch(() => props.call, (c) => {
  noteDraft.value = (c?.note as string) || '';
  // The caller's number on an inbound call, the number dialled on an outbound
  // one: either way it is the other party, which is who the drawer is about.
  loadContact(c?.type === 'out' ? (c?.destination || c?.client) : c?.client);
});

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
.tr-block { margin-top: 14px; padding-top: 14px; border-top: 1px solid var(--rule); }
.tr-text { font-size: 13px; line-height: 1.65; color: var(--ink-soft); white-space: pre-wrap;
  max-height: 240px; overflow-y: auto; padding: 14px 16px; background: var(--paper-2);
  border: 1px solid var(--rule); border-radius: var(--radius); }
.tr-note { font-size: 11.5px; margin: 7px 0 0; }
.tr-err { font-size: 12px; color: var(--danger); margin: 7px 0 0; }
.drawer-rec { margin: 18px 0; padding: 14px 16px; border: 1px solid var(--rule); border-radius: var(--radius); }
.drawer-rec-label { display: block; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--ink-mute); margin-bottom: 8px; }
.drawer-rec-audio { width: 100%; height: 36px; }
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
.drawer-who { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 2px 0 6px; }
.drawer-who-name { font-size: 15px; font-weight: 600; color: var(--signal); text-decoration: none; }
.drawer-who-name:hover { text-decoration: underline; }
.drawer-who-co { font-size: 13px; color: var(--ink-mute); }
.drawer-who-tags { display: flex; flex-wrap: wrap; gap: 6px; width: 100%; }
.drawer-who-tags .crm-tag {
  display: inline-flex; padding: 2px 9px; border-radius: 999px; font-size: 12px;
  background: var(--signal-soft); color: var(--signal);
}
.drawer-enter-from, .drawer-leave-to { opacity: 0; }
.drawer-enter-from .drawer, .drawer-leave-to .drawer { transform: translateX(40px); }
</style>
