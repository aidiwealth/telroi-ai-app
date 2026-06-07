<template>
  <div>
    <h1 class="ad-title">Virtual AI Numbers</h1>
    <p class="ad-sub">Telroi’s own AI voice infrastructure — the same VAN system, AI provider connections, and call-quality optimization clients get, for Telroi’s support and sales lines.</p>

    <div class="ad-subnav">
      <button v-for="t in tabs" :key="t.key" class="ad-subtab" :class="{ on: tab === t.key }" @click="tab = t.key">{{ t.label }}</button>
    </div>

    <!-- Live AI calls — human takeover (always visible above the active sub-view) -->
    <section v-if="activeCalls.length" class="tk">
      <header class="tk-head">
        <div class="tk-head-left">
          <span class="tk-live"><span class="tk-live-dot" />LIVE</span>
          <h3 class="tk-title">AI calls in progress</h3>
        </div>
        <span class="tk-count">{{ activeCalls.length }} active</span>
      </header>
      <p class="tk-sub">Handled by an AI agent right now. Take over to bridge yourself in — the AI steps aside instantly.</p>

      <ul class="tk-list">
        <li v-for="c in activeCalls" :key="c.id" class="tk-item">
          <div class="tk-avatar"><span>{{ initials(c.visitorName) }}</span><span class="tk-avatar-ring" /></div>
          <div class="tk-info">
            <div class="tk-name">{{ cleanName(c.visitorName) }}</div>
            <div class="tk-meta">
              <span class="tk-phone mono">{{ c.visitorPhone }}</span>
              <span class="tk-dot">·</span>
              <span>{{ [c.city, c.country].filter(Boolean).join(', ') || 'Unknown location' }}</span>
            </div>
            <div class="tk-agent"><span class="tk-agent-glyph" /> {{ c.handledByLabel || 'AI agent' }}</div>
          </div>
          <button class="tk-btn" :disabled="takingOver === c.id" @click="takeOver(c)">
            <svg v-if="takingOver !== c.id" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
            <span>{{ takingOver === c.id ? 'Connecting…' : 'Take over' }}</span>
          </button>
        </li>
      </ul>
    </section>

    <!-- Sub-views: the EXACT client components, pointed at the support workspace -->
    <div v-show="tab === 'numbers'">
      <VansWorkspace api-base="/api/admin/support/vans" :bundled="true" />
    </div>
    <div v-show="tab === 'connections'">
      <AiConnectionsWorkspace api-base="/api/admin/support/ai/connections" agents-base="/api/admin/support/agents" />
    </div>
    <div v-show="tab === 'optimize'">
      <OptimizeWorkspace api-base="/api/admin/support/optimize" />
    </div>

    <!-- In-browser dialer for taking over a live AI call (mic + speaker + audio).
         Uses the support workspace's configured voice provider. -->
    <DialerModal v-if="dialer.open" :initial-phone="dialer.phone" :auto-start="true"
      token-endpoint="/api/admin/support/voice-token"
      numbers-endpoint="/api/admin/support/numbers"
      @close="dialer.open = false" />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
definePageMeta({ layout: 'admin' });
const toast = useToast();

const tabs = [
  { key: 'numbers', label: 'AI Numbers' },
  { key: 'connections', label: 'AI Connections' },
  { key: 'optimize', label: 'Optimize' }
];
const tab = ref('numbers');

const activeCalls = ref<any[]>([]);
const takingOver = ref<string | null>(null);
const dialer = ref<{ open: boolean; phone: string }>({ open: false, phone: '' });
// Strip a leading "Incoming — " prefix from seeded/live names for a cleaner label.
function cleanName(n?: string) { return (n || 'Caller').replace(/^\s*incoming\s*[—–-]\s*/i, '').trim() || 'Caller'; }
function initials(n?: string) {
  const s = cleanName(n);
  const parts = s.split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || 'C';
}

async function loadActive() {
  try { const r = await $fetch<any>('/api/admin/support/active-ai-calls'); activeCalls.value = r.calls || []; } catch { /* */ }
}
async function takeOver(c: any) {
  takingOver.value = c.id;
  try {
    // 1. Drop the AI and mark this admin as the human handler (server-side).
    await $fetch('/api/admin/support/takeover', { method: 'POST', body: { callid: `lc_${c.id}` } });
    await loadActive();
    // 2. Open the in-browser dialer to actually hear/talk to the caller. It mints
    //    a browser-voice token from the support workspace's configured provider,
    //    requests the mic, and bridges live audio (Twilio / Telnyx / Digidite).
    if (c.visitorPhone) {
      dialer.value = { open: true, phone: c.visitorPhone };
    } else {
      toast.ok('You are now the handler, but this call has no caller number to dial back.');
    }
  }
  catch (e: any) { toast.err(e?.data?.error?.message || 'Could not take over'); }
  finally { takingOver.value = null; }
}

let poll: any = null;
onMounted(() => { loadActive(); poll = setInterval(loadActive, 8000); });
onUnmounted(() => { if (poll) clearInterval(poll); });
useHead({ title: 'Virtual AI Numbers — Telroi Admin' });
</script>

<style scoped>
.ad-subnav { display: flex; gap: 4px; border-bottom: 1px solid var(--rule); margin-bottom: 22px; }
.ad-subtab { padding: 10px 16px; font-size: 14px; font-weight: 500; color: var(--ink-mute); border-bottom: 2px solid transparent; margin-bottom: -1px; }
.ad-subtab:hover { color: var(--ink-soft); }
.ad-subtab.on { color: var(--signal); border-bottom-color: var(--signal); }
/* Live AI calls — take-over panel (sleek, on-brand) */
.tk {
  background: var(--paper);
  border: 1px solid var(--rule);
  border-radius: var(--radius-lg);
  padding: 20px 22px;
  margin-bottom: 22px;
  position: relative;
  overflow: hidden;
}
.tk::before {
  content: '';
  position: absolute; inset: 0 0 auto 0; height: 3px;
  background: linear-gradient(90deg, var(--live, #00d28a), transparent 70%);
}
.tk-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.tk-head-left { display: flex; align-items: center; gap: 12px; }
.tk-live {
  display: inline-flex; align-items: center; gap: 6px;
  font-family: var(--font-mono); font-size: 10.5px; font-weight: 700; letter-spacing: 0.1em;
  color: #0a8a5c; background: rgba(0,210,138,0.12);
  padding: 3px 9px; border-radius: 999px;
}
.tk-live-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--live, #00d28a); box-shadow: 0 0 0 0 rgba(0,210,138,0.5); animation: tk-pulse 1.8s ease-out infinite; }
@keyframes tk-pulse { 0% { box-shadow: 0 0 0 0 rgba(0,210,138,0.5); } 70% { box-shadow: 0 0 0 6px rgba(0,210,138,0); } 100% { box-shadow: 0 0 0 0 rgba(0,210,138,0); } }
.tk-title { font-size: 15px; font-weight: 600; color: var(--ink); margin: 0; }
.tk-count { font-size: 12px; color: var(--ink-mute); font-variant-numeric: tabular-nums; }
.tk-sub { font-size: 12.5px; color: var(--ink-mute); margin: 6px 0 16px; line-height: 1.5; max-width: 60ch; }

.tk-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.tk-item {
  display: flex; align-items: center; gap: 14px;
  padding: 12px 14px;
  background: var(--paper-2, #f7f6f3);
  border: 1px solid var(--rule-2, #efede8);
  border-radius: var(--radius, 12px);
  transition: border-color .15s, background .15s, transform .15s;
}
.tk-item:hover { border-color: var(--rule); background: var(--paper); transform: translateY(-1px); }

.tk-avatar { position: relative; flex: none; width: 40px; height: 40px; }
.tk-avatar span:first-child {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  border-radius: 50%; background: var(--signal); color: #fff;
  font-size: 13.5px; font-weight: 600; letter-spacing: 0.02em;
}
.tk-avatar-ring { position: absolute; inset: -3px; border-radius: 50%; border: 1.5px solid rgba(0,210,138,0.5); animation: tk-ring 2s ease-out infinite; }
@keyframes tk-ring { 0% { transform: scale(0.85); opacity: 0.8; } 100% { transform: scale(1.15); opacity: 0; } }

.tk-info { flex: 1; min-width: 0; }
.tk-name { font-size: 14px; font-weight: 600; color: var(--ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tk-meta { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--ink-mute); margin-top: 2px; flex-wrap: wrap; }
.tk-phone { color: var(--ink-soft); }
.tk-dot { opacity: 0.5; }
.tk-agent { display: inline-flex; align-items: center; gap: 6px; font-size: 11.5px; color: var(--ink-mute); margin-top: 5px; }
.tk-agent-glyph { width: 6px; height: 6px; border-radius: 50%; background: var(--signal); opacity: 0.7; }

.tk-btn {
  flex: none; display: inline-flex; align-items: center; gap: 7px;
  font-family: inherit; font-size: 13px; font-weight: 600; color: #fff;
  background: var(--ink); border: none; border-radius: 999px;
  padding: 9px 16px; cursor: pointer; transition: opacity .15s, transform .12s;
}
.tk-btn:hover:not(:disabled) { opacity: 0.9; transform: translateY(-1px); }
.tk-btn:disabled { opacity: 0.55; cursor: default; }
.tk-btn svg { width: 15px; height: 15px; }

@media (max-width: 600px) {
  .tk-item { flex-wrap: wrap; }
  .tk-btn { width: 100%; justify-content: center; }
}
</style>
