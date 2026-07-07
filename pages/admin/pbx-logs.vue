<template>
  <div>
    <h1 class="ad-title">PBX live logs</h1>
    <p class="ad-sub">Real-time output from the voice control app, streamed from the PBX. Held in memory only (last 800 lines) — nothing is stored. Filter by text to follow one client, number, or call.</p>

    <div class="plog-bar">
      <div class="plog-search">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="7" cy="7" r="5"/><path d="M11 11l3.5 3.5" stroke-linecap="round"/></svg>
        <input v-model="filter" class="plog-input" placeholder="Filter — tenant id, number, call id, keyword…" />
        <button v-if="filter" class="plog-clear" @click="filter = ''" title="Clear filter">✕</button>
      </div>
      <label class="plog-toggle"><input type="checkbox" v-model="errorsOnly" /> Errors only</label>
      <button class="plog-btn" :class="{ on: live }" @click="live = !live">
        <span class="plog-dot" :class="{ pulsing: live }"></span>{{ live ? 'Live' : 'Paused' }}
      </button>
      <button class="plog-btn" @click="clearView" title="Clear the view (buffer keeps filling)">Clear</button>
      <span class="plog-status" :class="statusClass">{{ statusText }}</span>
    </div>

    <div ref="scroller" class="plog-console" @scroll="onScroll">
      <div v-if="!visibleLines.length" class="plog-empty">
        {{ filter || errorsOnly ? 'No lines match the current filter.' : 'Waiting for log output…' }}
      </div>
      <div v-for="l in visibleLines" :key="l.seq" class="plog-line" :class="`lvl-${l.level}`">
        <span class="plog-ts">{{ fmtTs(l.ts) }}</span>
        <span class="plog-text" v-html="highlight(l.text)"></span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, nextTick, watch } from 'vue';
import { useAdminApi } from '~/composables/useAdminApi';

definePageMeta({ layout: 'admin', middleware: 'superadmin' });
useHead({ title: 'PBX live logs — Telroi admin' });

interface LogLine { seq: number; ts: number; level: 'info' | 'error'; text: string; }

const api = useAdminApi();
const lines = ref<LogLine[]>([]);
const filter = ref('');
const errorsOnly = ref(false);
const live = ref(true);
const scroller = ref<HTMLElement | null>(null);
const atBottom = ref(true);
const connState = ref<'connecting' | 'ok' | 'error'>('connecting');
const lastError = ref('');
let lastSeq = 0;
let timer: any = null;

const MAX_VIEW = 800;

const visibleLines = computed(() => {
  const f = filter.value.trim().toLowerCase();
  let out = lines.value;
  if (errorsOnly.value) out = out.filter((l) => l.level === 'error');
  if (f) out = out.filter((l) => l.text.toLowerCase().includes(f));
  return out.slice(-MAX_VIEW);
});

const statusText = computed(() => {
  if (connState.value === 'error') return lastError.value || 'PBX unreachable';
  if (!live.value) return 'Paused';
  return connState.value === 'ok' ? 'Connected' : 'Connecting…';
});
const statusClass = computed(() => ({
  err: connState.value === 'error',
  ok: connState.value === 'ok' && live.value
}));

function fmtTs(ts: number) {
  const d = new Date(ts);
  return d.toLocaleTimeString(undefined, { hour12: false }) + '.' + String(d.getMilliseconds()).padStart(3, '0');
}

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function highlight(text: string) {
  const safe = escapeHtml(text);
  const f = filter.value.trim();
  if (!f) return safe;
  try {
    const re = new RegExp('(' + f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');
    return safe.replace(re, '<mark class="plog-mark">$1</mark>');
  } catch { return safe; }
}

async function poll() {
  if (!live.value) return;
  try {
    const res = await api.get<{ lines: LogLine[]; latest: number }>('/api/admin/pbx-logs', { after: lastSeq });
    connState.value = 'ok';
    if (res.lines?.length) {
      lines.value = lastSeq === 0 ? res.lines : [...lines.value, ...res.lines];
      if (lines.value.length > MAX_VIEW * 2) lines.value = lines.value.slice(-MAX_VIEW * 2);
      lastSeq = res.latest || (res.lines[res.lines.length - 1]?.seq ?? lastSeq);
      if (atBottom.value) await scrollToBottom();
    }
  } catch (e: any) {
    connState.value = 'error';
    lastError.value = e?.message || 'Could not reach the PBX log service';
  }
}

async function scrollToBottom() {
  await nextTick();
  const el = scroller.value;
  if (el) el.scrollTop = el.scrollHeight;
}

function onScroll() {
  const el = scroller.value;
  if (!el) return;
  atBottom.value = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
}

function clearView() {
  lines.value = [];
}

watch(live, (v) => { if (v) { atBottom.value = true; scrollToBottom(); } });

onMounted(() => {
  poll();
  timer = setInterval(poll, 2000);
});
onBeforeUnmount(() => { if (timer) clearInterval(timer); });
</script>

<style scoped>
.plog-bar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin: 16px 0 12px; }
.plog-search { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 260px; padding: 8px 12px; background: var(--paper); border: 1px solid var(--rule); border-radius: 9px; }
.plog-search svg { width: 15px; height: 15px; color: var(--ink-mute); flex: none; }
.plog-input { flex: 1; border: none; background: transparent; outline: none; font-size: 13px; color: var(--ink); }
.plog-clear { border: none; background: none; color: var(--ink-mute); cursor: pointer; font-size: 12px; padding: 2px 4px; }
.plog-toggle { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; color: var(--ink-soft); white-space: nowrap; }
.plog-btn { display: inline-flex; align-items: center; gap: 6px; padding: 8px 12px; font-size: 12.5px; border-radius: 8px; border: 1px solid var(--rule); background: var(--paper); color: var(--ink-soft); cursor: pointer; }
.plog-btn.on { color: var(--ink); border-color: var(--rule-2); }
.plog-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--ink-mute); }
.plog-dot.pulsing { background: #37b24d; animation: plog-pulse 1.4s ease-in-out infinite; }
@keyframes plog-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
.plog-status { font-size: 12px; margin-left: auto; color: var(--ink-mute); }
.plog-status.ok { color: #2f9e44; }
.plog-status.err { color: var(--danger, #e03131); }
.plog-console { height: 62vh; overflow-y: auto; background: #0c1116; border: 1px solid #1c2530; border-radius: 12px; padding: 12px 14px; font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; font-size: 12.5px; line-height: 1.65; }
.plog-empty { color: #5b6b7a; padding: 20px 4px; font-family: system-ui, sans-serif; font-size: 13px; }
.plog-line { display: flex; gap: 12px; white-space: pre-wrap; word-break: break-word; padding: 1px 0; }
.plog-ts { color: #5b7089; flex: none; }
.plog-text { color: #cdd6e0; }
.lvl-error .plog-text { color: #ff8787; }
.lvl-error { background: rgba(224, 49, 49, 0.08); border-radius: 4px; }
:deep(.plog-mark) { background: #ffd43b; color: #1a1a1a; border-radius: 2px; padding: 0 1px; }
@media (max-width: 640px) { .plog-status { margin-left: 0; width: 100%; } .plog-console { height: 55vh; font-size: 11.5px; } }
</style>
