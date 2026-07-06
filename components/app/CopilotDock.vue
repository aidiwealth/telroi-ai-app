<template>
  <div class="cp-root">
    <!-- Collapsed: edge pill on the right, below the setup-tasks dock -->
    <div v-if="collapsed" class="cp-dock">
      <button class="cp-edge" @click="open()" title="Copilot — ask me to help run your account">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M12 3a4 4 0 0 1 4 4c0 1.5-.8 2.3-1.5 3M12 3a4 4 0 0 0-4 4c0 1.5.8 2.3 1.5 3M9 17h6M10 21h4M12 10v7"/></svg>
        <span>Copilot</span>
      </button>
    </div>

    <!-- Open: chat panel -->
    <div v-else class="cp-panel">
      <div class="cp-head">
        <div class="cp-title"><span class="cp-dot" /> Telroi Copilot</div>
        <button class="cp-x" @click="close()" title="Collapse">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg>
        </button>
      </div>

      <div ref="scrollEl" class="cp-body">
        <div v-if="!messages.length" class="cp-empty">
          <p class="cp-empty-t">Hi! I can help you run your account.</p>
          <div class="cp-sugs">
            <button v-for="s in suggestions" :key="s" class="cp-sug" @click="send(s)">{{ s }}</button>
          </div>
        </div>
        <div v-for="(m, i) in messages" :key="i" class="cp-msg" :class="m.role">
          <div class="cp-bubble">{{ m.content }}</div>
          <div v-if="m.links && m.links.length" class="cp-links">
            <NuxtLink v-for="l in m.links" :key="l.to" :to="l.to" class="cp-link" @click="close()">{{ l.label }} →</NuxtLink>
          </div>
        </div>
        <div v-if="busy" class="cp-msg assistant"><div class="cp-bubble cp-typing"><span /><span /><span /></div></div>
      </div>

      <div class="cp-input">
        <input v-model="draft" class="cp-in" placeholder="Ask me anything…" :disabled="busy" @keyup.enter="send()" />
        <button class="cp-send" :disabled="busy || !draft.trim()" @click="send()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, nextTick } from 'vue';
const props = withDefaults(defineProps<{ apiBase?: string }>(), { apiBase: '/api/copilot' });

interface Msg { role: 'user' | 'assistant'; content: string; links?: Array<{ label: string; to: string }>; }
const collapsed = ref(true);
const draft = ref('');
const busy = ref(false);
const messages = ref<Msg[]>([]);
const scrollEl = ref<HTMLElement | null>(null);
const suggestions = ['How are my calls doing?', 'How do I set up an AI agent?', 'Create a Virtual AI Number', 'Upload a knowledge base'];

function open() { collapsed.value = false; }
function close() { collapsed.value = true; }

async function scrollDown() { await nextTick(); if (scrollEl.value) scrollEl.value.scrollTop = scrollEl.value.scrollHeight; }

async function send(preset?: string) {
  const text = (preset || draft.value).trim();
  if (!text || busy.value) return;
  draft.value = '';
  messages.value.push({ role: 'user', content: text });
  await scrollDown();
  busy.value = true;
  try {
    const history = messages.value.slice(-6).map((m) => ({ role: m.role, content: m.content }));
    const r = await $fetch<{ reply: string; links?: Array<{ label: string; to: string }> }>(`${props.apiBase}/chat`, {
      method: 'POST', body: { message: text, history: history.slice(0, -1) }
    });
    messages.value.push({ role: 'assistant', content: r.reply || 'Sorry, I could not respond.', links: r.links });
  } catch (e: any) {
    messages.value.push({ role: 'assistant', content: e?.data?.message || 'Something went wrong. Please try again.' });
  } finally { busy.value = false; await scrollDown(); }
}
</script>

<style scoped>
.cp-dock { position: fixed; right: 0; top: calc(50% + 84px); transform: translateY(-50%); z-index: 89; }
.cp-edge { display: flex; align-items: center; gap: 7px; padding: 10px 12px 10px 14px; border: none; border-radius: 12px 0 0 12px; background: var(--ink, #0C2057); color: #fff; cursor: pointer; box-shadow: 0 4px 16px rgba(0,0,0,0.18); font-size: 13px; font-weight: 600; }
.cp-edge svg { width: 18px; height: 18px; }
.cp-edge:hover { filter: brightness(1.08); }

.cp-panel { position: fixed; right: 20px; top: 50%; transform: translateY(-50%); z-index: 201; width: 380px; max-width: calc(100vw - 32px); height: 560px; max-height: calc(100vh - 80px); display: flex; flex-direction: column; background: var(--paper, #fff); border: 1px solid var(--rule-2, rgba(0,0,0,0.08)); border-radius: 16px; box-shadow: 0 18px 60px rgba(0,0,0,0.28); overflow: hidden; }
.cp-head { display: flex; align-items: center; justify-content: space-between; padding: 14px 16px; border-bottom: 1px solid var(--rule-2, rgba(0,0,0,0.08)); background: var(--paper-2, #f7f6f2); }
.cp-title { display: flex; align-items: center; gap: 8px; font-weight: 700; font-size: 14px; }
.cp-dot { width: 8px; height: 8px; border-radius: 50%; background: #2ecc71; }
.cp-x { border: none; background: none; cursor: pointer; color: var(--ink-mute, #888); padding: 4px; }
.cp-x svg { width: 16px; height: 16px; }

.cp-body { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 12px; }
.cp-empty-t { font-size: 14px; color: var(--ink-soft, #555); margin: 4px 0 12px; }
.cp-sugs { display: flex; flex-direction: column; gap: 8px; }
.cp-sug { text-align: left; padding: 10px 12px; border: 1px solid var(--rule-2, rgba(0,0,0,0.1)); border-radius: 10px; background: none; cursor: pointer; font-size: 13px; color: var(--ink, #0C2057); }
.cp-sug:hover { background: var(--paper-2, #f7f6f2); border-color: var(--ink, #0C2057); }

.cp-msg { display: flex; flex-direction: column; gap: 6px; }
.cp-msg.user { align-items: flex-end; }
.cp-bubble { max-width: 85%; padding: 9px 13px; border-radius: 14px; font-size: 13.5px; line-height: 1.45; white-space: pre-wrap; }
.cp-msg.user .cp-bubble { background: var(--ink, #0C2057); color: #fff; border-bottom-right-radius: 4px; }
.cp-msg.assistant .cp-bubble { background: var(--paper-2, #f2f1ec); color: var(--ink, #14203a); border-bottom-left-radius: 4px; }
.cp-links { display: flex; flex-wrap: wrap; gap: 6px; }
.cp-link { font-size: 12.5px; padding: 5px 10px; border-radius: 8px; background: rgba(200,150,46,0.14); color: #a8791f; text-decoration: none; font-weight: 600; }
.cp-link:hover { background: rgba(200,150,46,0.24); }
.cp-typing { display: flex; gap: 4px; }
.cp-typing span { width: 6px; height: 6px; border-radius: 50%; background: var(--ink-mute, #aaa); animation: cpb 1s infinite; }
.cp-typing span:nth-child(2) { animation-delay: .15s; }
.cp-typing span:nth-child(3) { animation-delay: .3s; }
@keyframes cpb { 0%, 60%, 100% { opacity: .3; } 30% { opacity: 1; } }

.cp-input { display: flex; gap: 8px; padding: 12px; border-top: 1px solid var(--rule-2, rgba(0,0,0,0.08)); }
.cp-in { flex: 1; padding: 10px 12px; border: 1px solid var(--rule-2, rgba(0,0,0,0.12)); border-radius: 10px; font-size: 13.5px; outline: none; }
.cp-in:focus { border-color: var(--ink, #0C2057); }
.cp-send { border: none; background: var(--ink, #0C2057); color: #fff; border-radius: 10px; width: 40px; display: flex; align-items: center; justify-content: center; cursor: pointer; }
.cp-send:disabled { opacity: .4; cursor: not-allowed; }
.cp-send svg { width: 17px; height: 17px; }
</style>
