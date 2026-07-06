<template>
  <div class="cp-root">
    <!-- Collapsed: edge pill on the right, below the setup-tasks dock -->
    <div v-if="collapsed" class="cp-dock">
      <button class="cp-edge" @click="open()" title="Copilot — ask me to help run your account">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4c3.9 0 7 2.6 7 5.8 0 .7-.6 1.2-1.3 1.2H6.3C5.6 11 5 10.5 5 9.8 5 6.6 8.1 4 12 4z"/><path d="M3.5 13.5c1.2.9 3 1.5 5 1.5M20.5 13.5c-1.2.9-3 1.5-5 1.5"/><circle cx="12" cy="8" r="1.2" fill="currentColor" stroke="none"/><path d="M8 15c0 1.5 1.8 2.5 4 2.5s4-1 4-2.5"/></svg>
        <span>Copilot</span>
      </button>
    </div>

    <!-- Open: centered full conversation view (Claude/ChatGPT style) -->
    <div v-else class="cp-scrim" @click.self="close()">
      <div class="cp-modal">
        <div v-if="showHistory" class="cp-history">
          <div class="cp-history-head">Previous chats<button class="cp-x" @click="showHistory = false"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>
          <div class="cp-history-list">
            <button v-if="!history.length" class="cp-history-empty" disabled>No saved chats yet</button>
            <button v-for="h in history" :key="h.id" class="cp-history-item" @click="openConversation(h.id)">{{ h.title }}</button>
          </div>
        </div>
        <div class="cp-head">
          <div class="cp-title"><span class="cp-dot" /> Telroi Copilot</div>
          <div class="cp-head-actions">
            <button class="cp-ghost" @click="toggleHistory()" title="Chat history">History</button>
            <button v-if="messages.length" class="cp-ghost" @click="reset()" title="New conversation">New chat</button>
            <button class="cp-x" @click="close()" title="Close">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg>
            </button>
          </div>
        </div>

        <div ref="scrollEl" class="cp-body">
          <div class="cp-thread">
            <div v-if="!messages.length" class="cp-welcome">
              <div class="cp-welcome-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4c3.9 0 7 2.6 7 5.8 0 .7-.6 1.2-1.3 1.2H6.3C5.6 11 5 10.5 5 9.8 5 6.6 8.1 4 12 4z"/><path d="M3.5 13.5c1.2.9 3 1.5 5 1.5M20.5 13.5c-1.2.9-3 1.5-5 1.5"/><circle cx="12" cy="8" r="1.2" fill="currentColor" stroke="none"/><path d="M8 15c0 1.5 1.8 2.5 4 2.5s4-1 4-2.5"/></svg>
              </div>
              <h2 class="cp-welcome-t">How can I help you run your account?</h2>
              <p class="cp-welcome-s">Ask about your calls, set up agents and numbers, or find a feature.</p>
              <div class="cp-sugs">
                <button v-for="s in suggestions" :key="s" class="cp-sug" @click="send(s)">{{ s }}</button>
              </div>
            </div>

            <div v-for="(m, i) in messages" :key="i" class="cp-row" :class="m.role">
              <div class="cp-avatar" :class="m.role">
                <template v-if="m.role === 'assistant'"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4c3.9 0 7 2.6 7 5.8 0 .7-.6 1.2-1.3 1.2H6.3C5.6 11 5 10.5 5 9.8 5 6.6 8.1 4 12 4z"/><path d="M3.5 13.5c1.2.9 3 1.5 5 1.5M20.5 13.5c-1.2.9-3 1.5-5 1.5"/><circle cx="12" cy="8" r="1.2" fill="currentColor" stroke="none"/><path d="M8 15c0 1.5 1.8 2.5 4 2.5s4-1 4-2.5"/></svg></template>
                <template v-else>You</template>
              </div>
              <div class="cp-content">
                <div class="cp-text">{{ m.content }}</div>
                <div v-if="m.links && m.links.length" class="cp-links">
                  <NuxtLink v-for="l in m.links" :key="l.to" :to="l.to" class="cp-link" @click="close()">{{ l.label }} →</NuxtLink>
                </div>
                <div v-if="m.action" class="cp-action" :class="'cp-action-' + (m.actionState || 'pending')">
                  <div class="cp-action-row"><i class="cp-action-ic"></i><span class="cp-action-txt">{{ m.action.preview }}</span></div>
                  <div v-if="m.actionState === 'pending'" class="cp-action-btns">
                    <button class="cp-act-cancel" @click="cancelAction(m)">Cancel</button>
                    <button class="cp-act-confirm" @click="confirmAction(m)">Confirm</button>
                  </div>
                  <div v-else-if="m.actionState === 'running'" class="cp-action-status">Working…</div>
                  <div v-else-if="m.actionState === 'done'" class="cp-action-status cp-ok">✓ {{ m.actionResult }}</div>
                  <div v-else-if="m.actionState === 'cancelled'" class="cp-action-status">Cancelled</div>
                  <div v-if="m.actionResult && m.actionState === 'pending'" class="cp-action-err">{{ m.actionResult }}</div>
                </div>
              </div>
            </div>

            <div v-if="busy" class="cp-row assistant">
              <div class="cp-avatar assistant"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4c3.9 0 7 2.6 7 5.8 0 .7-.6 1.2-1.3 1.2H6.3C5.6 11 5 10.5 5 9.8 5 6.6 8.1 4 12 4z"/><path d="M3.5 13.5c1.2.9 3 1.5 5 1.5M20.5 13.5c-1.2.9-3 1.5-5 1.5"/><circle cx="12" cy="8" r="1.2" fill="currentColor" stroke="none"/><path d="M8 15c0 1.5 1.8 2.5 4 2.5s4-1 4-2.5"/></svg></div>
              <div class="cp-content"><div class="cp-typing"><span /><span /><span /></div></div>
            </div>
          </div>
        </div>

        <div class="cp-input-wrap">
          <div class="cp-input">
            <textarea ref="inputEl" v-model="draft" class="cp-in" rows="1" placeholder="Ask anything…" :disabled="busy" @keydown="onKey" @input="autoGrow"></textarea>
            <button class="cp-send" :disabled="busy || !draft.trim()" @click="send()">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>
            </button>
          </div>
          <div class="cp-foot">Copilot can guide you and answer account questions.</div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, nextTick, onMounted } from 'vue';
const props = withDefaults(defineProps<{ apiBase?: string }>(), { apiBase: '/api/copilot' });

interface Msg { role: 'user' | 'assistant'; content: string; links?: Array<{ label: string; to: string }>; action?: any; actionState?: 'pending' | 'running' | 'done' | 'cancelled'; actionResult?: string; }
const collapsed = ref(true);
const draft = ref('');
const busy = ref(false);
const messages = ref<Msg[]>([]);
const conversationId = ref<string | null>(null);
const history = ref<Array<{ id: string; title: string; updatedAt: string }>>([]);
const showHistory = ref(false);
const scrollEl = ref<HTMLElement | null>(null);
const inputEl = ref<HTMLTextAreaElement | null>(null);
const suggestions = ['How are my calls doing?', 'How do I set up an AI agent?', 'Create a Virtual AI Number', 'Upload a knowledge base'];

function open() { collapsed.value = false; nextTick(() => inputEl.value?.focus()); }
function close() { collapsed.value = true; }
function reset() { messages.value = []; draft.value = ''; conversationId.value = null; showHistory.value = false; }

async function loadHistory() {
  try { history.value = await $fetch(`${props.apiBase}/conversations`); } catch { history.value = []; }
}
async function openConversation(id: string) {
  try {
    const c = await $fetch<{ id: string; messages: Msg[] }>(`${props.apiBase}/conversations/${id}`);
    messages.value = (c.messages || []).map((m: any) => ({ role: m.role, content: m.content }));
    conversationId.value = c.id; showHistory.value = false;
    await scrollDown();
  } catch { /* ignore */ }
}
async function saveConversation() {
  const plain = messages.value.filter((m) => m.content).map((m) => ({ role: m.role, content: m.content }));
  if (!plain.length) return;
  try {
    const r = await $fetch<{ id: string }>(`${props.apiBase}/conversations/save`, { method: 'POST', body: { id: conversationId.value, messages: plain } });
    if (r?.id) conversationId.value = r.id;
  } catch { /* ignore */ }
}
async function toggleHistory() { showHistory.value = !showHistory.value; if (showHistory.value) await loadHistory(); }

onMounted(async () => {
  // First visit after signup: open the copilot once (server-tracked per account)
  // with a warm setup welcome pointing to the setup checklist in the sidebar.
  try {
    const me = await $fetch<{ user?: { copilotOnboarded?: boolean } }>('/api/auth/me');
    if (!me?.user || me.user.copilotOnboarded) return;
    await $fetch('/api/copilot/onboarded', { method: 'POST' }).catch(() => {});
    messages.value.push({
      role: 'assistant',
      content: "Welcome to Telroi! I'm your Copilot \u2014 I can help you set up and run your account. To get started, open the setup checklist from the tab on the right edge of your screen: it walks you through connecting an AI agent, adding a number, and going live. Ask me anything along the way \u2014 like \u201chow do I set up an AI agent?\u201d or \u201ccreate a department called Sales\u201d \u2014 and I'll guide you or do it for you."
    });
    setTimeout(() => { collapsed.value = false; }, 900);
  } catch { /* ignore */ }
});

function autoGrow() { const el = inputEl.value; if (!el) return; el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 160) + 'px'; }
function onKey(e: KeyboardEvent) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }

async function scrollDown() { await nextTick(); if (scrollEl.value) scrollEl.value.scrollTop = scrollEl.value.scrollHeight; }

async function confirmAction(m: any) {
  if (!m.action || m.actionState !== 'pending') return;
  m.actionState = 'running';
  try {
    const r = await $fetch<{ ok: boolean; message?: string }>(`${props.apiBase}/execute`, {
      method: 'POST', body: { action: m.action.type, args: m.action.args }
    });
    m.actionState = 'done';
    m.actionResult = r.message || 'Done.';
  } catch (e: any) {
    m.actionState = 'pending';
    m.actionResult = e?.data?.message || 'That did not work. Please try again.';
  }
}
function cancelAction(m: any) { if (m.actionState === 'pending') m.actionState = 'cancelled'; }

async function send(preset?: string) {
  const text = (preset || draft.value).trim();
  if (!text || busy.value) return;
  draft.value = '';
  if (inputEl.value) inputEl.value.style.height = 'auto';
  messages.value.push({ role: 'user', content: text });
  await scrollDown();
  busy.value = true;
  try {
    const history = messages.value.slice(-6).map((m) => ({ role: m.role, content: m.content }));
    const r = await $fetch<{ reply: string; links?: Array<{ label: string; to: string }>; action?: any }>(`${props.apiBase}/chat`, {
      method: 'POST', body: { message: text, history: history.slice(0, -1) }
    });
    messages.value.push({ role: 'assistant', content: r.reply || (r.action ? '' : 'Sorry, I could not respond.'), links: r.links, action: r.action || null, actionState: r.action ? 'pending' : undefined });
  } catch (e: any) {
    messages.value.push({ role: 'assistant', content: e?.data?.message || 'Something went wrong. Please try again.' });
  } finally { busy.value = false; await scrollDown(); saveConversation(); }
}
</script>

<style scoped>
/* Collapsed edge pill (unchanged position: right-middle, under setup tasks) */
.cp-dock { position: fixed; right: 0; top: calc(50% + 52px); z-index: 89; }
.cp-edge { display: flex; align-items: center; gap: 7px; padding: 10px 12px 10px 14px; border: none; border-radius: 12px 0 0 12px; background: var(--signal, #1a4b72); color: #fff; cursor: pointer; box-shadow: 0 4px 16px rgba(0,0,0,0.18); font-size: 13px; font-weight: 600; }
.cp-edge svg { width: 18px; height: 18px; }
.cp-edge:hover { filter: brightness(1.08); }

/* Centered conversation modal */
.cp-scrim { position: fixed; inset: 0; z-index: 210; background: rgba(12,16,30,0.55); backdrop-filter: blur(3px); display: flex; align-items: center; justify-content: center; padding: 24px; }
.cp-modal { width: 100%; max-width: 760px; height: 100%; max-height: 820px; display: flex; flex-direction: column; background: var(--paper, #fff); border-radius: 18px; box-shadow: 0 24px 80px rgba(0,0,0,0.4); overflow: hidden; }

.cp-head { display: flex; align-items: center; justify-content: space-between; padding: 14px 20px; border-bottom: 1px solid var(--rule-2, rgba(0,0,0,0.07)); }
.cp-title { display: flex; align-items: center; gap: 9px; font-weight: 700; font-size: 15px; }
.cp-dot { width: 8px; height: 8px; border-radius: 50%; background: #2ecc71; }
.cp-head-actions { display: flex; align-items: center; gap: 6px; }
.cp-ghost { border: 1px solid var(--rule-2, rgba(0,0,0,0.12)); background: none; border-radius: 8px; padding: 6px 11px; font-size: 12.5px; cursor: pointer; color: var(--ink-soft, #555); }
.cp-ghost:hover { background: var(--paper-2, #f5f4ef); }
.cp-x { border: none; background: none; cursor: pointer; color: var(--ink-mute, #999); padding: 4px; }
.cp-x svg { width: 18px; height: 18px; }

.cp-history { position: absolute; inset: 0; z-index: 3; background: var(--paper, #fff); display: flex; flex-direction: column; }
.cp-history-head { display: flex; align-items: center; justify-content: space-between; padding: 16px 20px; border-bottom: 1px solid var(--rule-2, rgba(0,0,0,0.07)); font-weight: 600; font-size: 14px; }
.cp-history-list { flex: 1; overflow-y: auto; padding: 10px; display: flex; flex-direction: column; gap: 4px; }
.cp-history-item { text-align: left; padding: 12px 14px; border: none; background: none; border-radius: 10px; cursor: pointer; font-size: 13.5px; color: var(--ink, #1a2438); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cp-history-item:hover { background: var(--paper-2, #f5f4ef); }
.cp-history-empty { text-align: center; padding: 24px; color: var(--ink-mute, #999); font-size: 13px; background: none; border: none; }
.cp-body { flex: 1; overflow-y: auto; }
.cp-thread { max-width: 640px; margin: 0 auto; padding: 28px 24px; display: flex; flex-direction: column; gap: 26px; }

.cp-welcome { text-align: center; padding: 48px 0 24px; }
.cp-welcome-icon { width: 48px; height: 48px; margin: 0 auto 18px; border-radius: 14px; background: var(--signal, #1a4b72); color: #fff; display: flex; align-items: center; justify-content: center; }
.cp-welcome-icon svg { width: 26px; height: 26px; }
.cp-welcome-t { font-size: 21px; font-weight: 700; margin: 0 0 6px; color: var(--ink, #14203a); }
.cp-welcome-s { font-size: 14px; color: var(--ink-soft, #666); margin: 0 0 24px; }
.cp-sugs { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; max-width: 460px; margin: 0 auto; }
.cp-sug { text-align: left; padding: 13px 15px; border: 1px solid var(--rule-2, rgba(0,0,0,0.1)); border-radius: 12px; background: none; cursor: pointer; font-size: 13.5px; color: var(--signal, #1a4b72); transition: all .12s; }
.cp-sug:hover { background: var(--paper-2, #f7f6f2); border-color: var(--signal, #1a4b72); }

.cp-row { display: flex; gap: 14px; }
.cp-avatar { flex-shrink: 0; width: 30px; height: 30px; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; }
.cp-avatar.assistant { background: var(--signal, #1a4b72); color: #fff; }
.cp-avatar.assistant svg { width: 17px; height: 17px; }
.cp-avatar.user { background: var(--paper-2, #e8e6df); color: var(--ink-soft, #555); }
.cp-content { flex: 1; min-width: 0; padding-top: 4px; }
.cp-text { font-size: 14.5px; line-height: 1.6; color: var(--ink, #1a2438); white-space: pre-wrap; }
.cp-links { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
.cp-link { font-size: 13px; padding: 6px 12px; border-radius: 9px; background: rgba(200,150,46,0.14); color: #a8791f; text-decoration: none; font-weight: 600; }
.cp-link:hover { background: rgba(200,150,46,0.24); }
.cp-action { margin-top: 12px; border: 1px solid var(--rule-2, rgba(0,0,0,0.1)); border-radius: 12px; padding: 12px 14px; background: var(--paper-2, #f7f6f2); }
.cp-action-row { display: flex; align-items: flex-start; gap: 9px; }
.cp-action-ic { flex-shrink: 0; width: 8px; height: 8px; margin-top: 6px; border-radius: 50%; background: var(--signal, #1a4b72); }
.cp-action-txt { font-size: 13.5px; color: var(--ink, #1a2438); line-height: 1.5; }
.cp-action-btns { display: flex; gap: 8px; margin-top: 11px; }
.cp-act-confirm { flex: 1; padding: 9px; border: none; border-radius: 9px; background: var(--signal, #1a4b72); color: #fff; font-size: 13px; font-weight: 600; cursor: pointer; }
.cp-act-cancel { padding: 9px 14px; border: 1px solid var(--rule-2, rgba(0,0,0,0.14)); border-radius: 9px; background: none; color: var(--ink-soft, #555); font-size: 13px; cursor: pointer; }
.cp-action-status { margin-top: 9px; font-size: 13px; color: var(--ink-soft, #666); }
.cp-action-status.cp-ok { color: #2a8c5a; font-weight: 600; }
.cp-action-err { margin-top: 8px; font-size: 12.5px; color: #c0392b; }
.cp-typing { display: flex; gap: 5px; padding-top: 6px; }
.cp-typing span { width: 7px; height: 7px; border-radius: 50%; background: var(--ink-mute, #bbb); animation: cpb 1s infinite; }
.cp-typing span:nth-child(2) { animation-delay: .15s; }
.cp-typing span:nth-child(3) { animation-delay: .3s; }
@keyframes cpb { 0%, 60%, 100% { opacity: .3; } 30% { opacity: 1; } }

.cp-input-wrap { border-top: 1px solid var(--rule-2, rgba(0,0,0,0.07)); padding: 14px 24px 12px; }
.cp-input { max-width: 640px; margin: 0 auto; display: flex; gap: 10px; align-items: flex-end; border: 1px solid var(--rule-2, rgba(0,0,0,0.14)); border-radius: 14px; padding: 8px 8px 8px 14px; background: var(--paper, #fff); }
.cp-input:focus-within { border-color: var(--signal, #1a4b72); }
.cp-in { flex: 1; border: none; outline: none; resize: none; font-size: 14.5px; line-height: 1.5; font-family: inherit; padding: 5px 0; max-height: 160px; background: transparent; color: var(--ink, #1a2438); }
.cp-send { flex-shrink: 0; border: none; background: var(--signal, #1a4b72); color: #fff; border-radius: 10px; width: 38px; height: 38px; display: flex; align-items: center; justify-content: center; cursor: pointer; }
.cp-send:disabled { opacity: .35; cursor: not-allowed; }
.cp-send svg { width: 17px; height: 17px; }
.cp-foot { max-width: 640px; margin: 8px auto 0; text-align: center; font-size: 11.5px; color: var(--ink-mute, #aaa); }

@media (max-width: 640px) {
  .cp-scrim { padding: 0; }
  .cp-modal { max-height: 100%; border-radius: 0; }
  .cp-sugs { grid-template-columns: 1fr; }
}
</style>
