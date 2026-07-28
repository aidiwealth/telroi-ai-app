<template>
  <div v-if="tasks.length">
    <!-- Collapsed: a slim tab on the right edge -->
    <div v-if="collapsed" class="todo-dock">
      <button class="edge-tab" @click="setCollapsed(false)" :title="`${tasks.length} setup ${tasks.length === 1 ? 'task' : 'tasks'}`">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
        <span class="edge-tab-count">{{ tasks.length }}</span>
      </button>
    </div>

    <!-- Expanded: a centered modal over the whole page -->
    <div v-else class="todo-overlay" @click.self="setCollapsed(true)">
      <div class="todo-panel">
        <div class="todo-head">
          <div class="todo-head-text">
            <span class="todo-title">Finish setting up</span>
            <span class="todo-sub">
              {{ yourTurn.length ? `${yourTurn.length} waiting on you` : 'Nothing needs you right now' }}
              <template v-if="yourTurn.length < tasks.length">
                · {{ tasks.length - yourTurn.length }} in progress
              </template>
            </span>
          </div>
          <button class="todo-collapse" @click="setCollapsed(true)" title="Close">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        </div>

        <div class="todo-list">
          <div v-for="t in sortedTasks" :key="t.id" class="todo-item" :class="t.owner">
            <div class="todo-item-top">
              <!-- The icon carries the state faster than the words do: a tick for
                   what's yours to do, a clock for what we're doing, a ring for
                   what needs a conversation. -->
              <span class="todo-icon" :class="t.owner">
                <svg v-if="t.owner === 'client'" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
                <svg v-else-if="t.owner === 'admin'" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
                <svg v-else viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3"/><path d="M12 17h.01"/></svg>
              </span>
              <span class="todo-item-title">{{ t.title }}</span>
              <span class="todo-badge" :class="t.owner">{{ ownerLabel(t.owner) }}</span>
            </div>
            <p class="todo-item-desc">{{ t.desc }}</p>
            <div class="todo-item-actions">
              <NuxtLink v-if="t.owner === 'client' && t.action" :to="t.action.to" class="todo-action" @click="setCollapsed(true)">{{ t.action.label }} →</NuxtLink>
              <a v-else-if="t.owner === 'support'" :href="supportMailto(t)" class="todo-action">Contact support →</a>
              <span v-else class="todo-pending">No action needed — we're on it</span>
            </div>
          </div>
        </div>

        <a :href="supportMailto()" class="todo-foot">Need help? {{ supportEmail }}</a>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
const api = useApi();

const tasks = ref<any[]>([]);
// What the client can act on comes first — a list that opens with things they
// can't do anything about reads as a wall rather than a next step.
const yourTurn = computed(() => tasks.value.filter((t) => t.owner === 'client'));
const sortedTasks = computed(() => [
  ...tasks.value.filter((t) => t.owner === 'client'),
  ...tasks.value.filter((t) => t.owner !== 'client')
]);
const supportEmail = ref('support@telroi.ai');
const COLLAPSE_KEY = 'telroi_setup_tasks_collapsed';
const collapsed = ref(true);

// Persist collapse: once collapsed, it stays collapsed across refreshes/logins
// until the user re-opens it.
function setCollapsed(v: boolean) {
  collapsed.value = v;
  if (import.meta.client) {
    try { localStorage.setItem(COLLAPSE_KEY, v ? '1' : '0'); } catch { /* ignore */ }
  }
}

function ownerLabel(o: string) {
  return ({ client: 'Your turn', admin: 'Activating', support: 'Support' } as any)[o] || o;
}
function supportMailto(t?: any) {
  const subj = encodeURIComponent(t ? `Help with: ${t.title}` : 'Telroi support request');
  return `mailto:${supportEmail.value}?subject=${subj}`;
}

async function load() {
  try {
    const r = await api.get<any>('/api/tenant/setup-tasks');
    tasks.value = r.tasks || [];
    supportEmail.value = r.supportEmail || 'support@telroi.ai';
  } catch { /* not signed in / no tenant — widget simply doesn't show */ }
}

onMounted(() => {
  if (import.meta.client) {
    // Starts collapsed. Copilot already opens on the dashboard, and two things
    // competing for attention makes a poor first impression — the tasks wait in
    // the sidebar until someone opens them, and stay open once they have.
    try { collapsed.value = localStorage.getItem(COLLAPSE_KEY) !== '0'; } catch { collapsed.value = true; }
  }
  load();
});
// Re-check when the user navigates, so resolved items drop off.
const router = useRouter();
router.afterEach(() => { load(); });
</script>

<style scoped>
/* Collapsed dock: vertically centered on the right edge. Shared sizing with the
   Live Call edge tab via a fixed width so the two never look mismatched. */
.todo-dock { position: fixed; right: 0; top: 50%; transform: translateY(-50%); z-index: 90; }
.edge-tab {
  display: flex; flex-direction: column; align-items: center; gap: 4px;
  width: 46px; box-sizing: border-box;
  background: var(--signal); color: #fff;
  padding: 12px 10px; border-radius: 12px 0 0 12px;
  box-shadow: -4px 4px 16px rgba(10,10,11,0.16);
  cursor: pointer;
}
.edge-tab-count { font-size: 12px; font-weight: 600; background: rgba(255,255,255,0.22); border-radius: 999px; min-width: 18px; height: 18px; display: flex; align-items: center; justify-content: center; }

/* Expanded: a centered modal overlaying the whole page. */
.todo-overlay {
  position: fixed; inset: 0; z-index: 200;
  background: rgba(10,10,11,0.32);
  display: flex; align-items: center; justify-content: center;
  padding: 24px;
  animation: todo-fade 0.16s ease;
}
@keyframes todo-fade { from { opacity: 0; } to { opacity: 1; } }
.todo-panel {
  width: 100%; max-width: 380px; max-height: 80vh; display: flex; flex-direction: column;
  background: var(--paper); border: 1px solid var(--rule); border-radius: var(--radius-lg);
  box-shadow: 0 24px 60px rgba(10,10,11,0.28); overflow: hidden;
  animation: todo-in 0.18s cubic-bezier(0.16,1,0.3,1);
}
@keyframes todo-in { from { opacity: 0; transform: translateY(10px) scale(0.98); } to { opacity: 1; transform: translateY(0) scale(1); } }
.todo-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding: 20px 22px; border-bottom: 1px solid var(--rule-2); background: var(--paper-2); }
.todo-head-text { display: flex; flex-direction: column; gap: 3px; }
.todo-title { display: block; font-weight: 600; font-size: 15px; }
.todo-sub { font-size: 12px; color: var(--ink-mute); }
.todo-collapse { width: 28px; height: 28px; border-radius: 8px; color: var(--ink-mute); display: flex; align-items: center; justify-content: center; }
.todo-collapse:hover { background: var(--paper-3); color: var(--ink); }
.todo-list { flex: 1; overflow-y: auto; padding: 10px; }
.todo-item { padding: 14px 16px; border-radius: var(--radius); border: 1px solid var(--rule-2); margin-bottom: 10px; transition: border-color .15s; }
/* What's theirs to do carries the accent; the rest stays quiet, so the list
   reads as "here's your next step" rather than a wall of equal demands. */
.todo-item.client { border-left: 2px solid var(--signal); background: var(--paper); }
.todo-item.client:hover { border-color: var(--signal); }
.todo-item:last-child { margin-bottom: 0; }
.todo-item-top { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; }
.todo-icon { flex: none; width: 26px; height: 26px; border-radius: 50%; display: flex; align-items: center; justify-content: center; }
.todo-icon.client { background: var(--signal-soft); color: var(--signal); }
.todo-icon.admin { background: rgba(183,121,31,0.12); color: var(--warn); }
.todo-icon.support { background: var(--paper-3); color: var(--ink-soft); }
/* Smaller now the icon says the same thing — confirmation rather than the signal. */
.todo-badge { margin-left: auto; flex: none; font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.05em; padding: 2px 7px; border-radius: 999px; font-weight: 600; }
.todo-badge.client { background: var(--signal-soft); color: var(--signal); }
.todo-badge.admin { background: rgba(183,121,31,0.14); color: var(--warn); }
.todo-badge.support { background: var(--paper-3); color: var(--ink-soft); }
.todo-item-title { font-size: 13.5px; font-weight: 500; flex: 1; min-width: 0; }
.todo-item-desc { font-size: 12.5px; color: var(--ink-soft); line-height: 1.55; margin: 0 0 10px 36px; }
.todo-action { font-size: 13px; color: var(--signal); font-weight: 500; }
.todo-action:hover { text-decoration: underline; }
.todo-pending { font-size: 12px; color: var(--ink-mute); font-style: italic; }
.todo-foot { display: block; text-align: center; font-size: 12px; color: var(--ink-mute); padding: 12px; border-top: 1px solid var(--rule-2); }
.todo-foot:hover { color: var(--signal); }
@media (max-width: 820px) { .todo-panel { max-width: calc(100vw - 24px); } }
</style>
