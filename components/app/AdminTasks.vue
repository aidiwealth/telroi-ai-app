<template>
  <div v-if="tasks.length">
    <div v-if="collapsed" class="atodo-dock">
      <button class="edge-tab" @click="setCollapsed(false)" :title="`${tasks.length} ${tasks.length === 1 ? 'task' : 'tasks'} to handle`">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
        <span>Tasks</span>
        <span class="edge-tab-count">{{ tasks.length }}</span>
      </button>
    </div>

    <div v-else class="atodo-overlay" @click.self="setCollapsed(true)">
      <div class="atodo-panel" role="dialog" aria-modal="true" aria-labelledby="atodo-title">
        <button class="atodo-close" @click="setCollapsed(true)" aria-label="Close">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
        </button>

        <div class="atodo-top">
          <span class="atodo-eyebrow">Action queue</span>
          <span class="atodo-count">{{ tasks.length }} to handle</span>
        </div>
        <h2 id="atodo-title" class="atodo-title">
          {{ issues.length ? `${issues.length} need${issues.length === 1 ? 's' : ''} attention` : 'Requests waiting on you' }}
        </h2>

        <!-- A queue, not a sequence: an operator picks what to work on, so they
             see the lot. Issues first — something broken outranks something asked for. -->
        <div class="atodo-list">
          <div v-for="t in sorted" :key="t.id" class="atodo-item" :class="t.kind">
            <span class="atodo-icon" :class="t.kind">
              <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
                <template v-if="t.kind === 'issue'"><path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></template>
                <template v-else><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></template>
              </svg>
            </span>
            <div class="atodo-item-body">
              <p class="atodo-item-title">{{ t.title }}</p>
              <p class="atodo-item-desc">{{ t.desc }}</p>
              <NuxtLink v-if="t.action" :to="t.action.to" class="atodo-action" @click="setCollapsed(true)">{{ t.action.label }} →</NuxtLink>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';

const tasks = ref<any[]>([]);
// Something broken outranks something asked for, so an operator scanning the
// queue meets the issues first.
const issues = computed(() => tasks.value.filter((t) => t.kind === 'issue'));
const sorted = computed(() => [
  ...tasks.value.filter((t) => t.kind === 'issue'),
  ...tasks.value.filter((t) => t.kind !== 'issue')
]);
const COLLAPSE_KEY = 'telroi_admin_tasks_collapsed';
const collapsed = ref(true);
function setCollapsed(v: boolean) {
  collapsed.value = v;
  if (import.meta.client) {
    try { localStorage.setItem(COLLAPSE_KEY, v ? '1' : '0'); } catch { /* ignore */ }
  }
}

async function load() {
  try {
    const r = await $fetch<any>('/api/admin/tasks');
    tasks.value = r.tasks || [];
  } catch { /* not an admin / not signed in — widget hidden */ }
}

onMounted(() => {
  if (import.meta.client) {
    // Starts docked, as the client's does. Opening over the dashboard on a first
    // visit competes with whatever the operator came to do.
    try { collapsed.value = localStorage.getItem(COLLAPSE_KEY) !== '0'; } catch { collapsed.value = true; }
  }
  load();
});
const router = useRouter();
router.afterEach(() => { load(); });
</script>

<style scoped>
/* Same tab as the client side, below Copilot rather than centred over it —
   an admin who also uses a client account shouldn't find the furniture moved. */
.atodo-dock { position: fixed; right: 0; top: calc(50% + 52px); z-index: 89; }
.edge-tab { display: flex; align-items: center; gap: 7px; padding: 10px 12px 10px 14px; border: 1px solid var(--rule); border-right: 0; border-radius: 12px 0 0 12px; background: var(--paper); color: var(--signal); cursor: pointer; box-shadow: -2px 0 10px rgba(10,10,11,.06); font-size: 13px; font-weight: 600; }
.edge-tab svg { width: 18px; height: 18px; }
.edge-tab:hover { background: var(--paper-2); }
.edge-tab-count { font-size: 11px; font-weight: 600; background: var(--signal); color: #fff; border-radius: 999px; min-width: 17px; padding: 1px 6px; text-align: center; }
.atodo-overlay {
  position: fixed; inset: 0; z-index: 200; background: rgba(10,10,11,.5);
  backdrop-filter: blur(3px);
  display: flex; align-items: center; justify-content: center; padding: 24px;
  animation: atodo-fade 0.16s ease;
}
@keyframes atodo-fade { from { opacity: 0; } to { opacity: 1; } }
.atodo-panel {
  position: relative;
  width: 100%; max-width: 560px; max-height: 82vh; display: flex; flex-direction: column;
  background: var(--paper); border: 1px solid var(--rule); border-radius: var(--radius-lg);
  padding: 40px 44px 28px;
  box-shadow: 0 24px 60px rgba(10,10,11,.22); overflow: hidden;
  animation: atodo-in 0.18s cubic-bezier(0.16,1,0.3,1);
}
@keyframes atodo-in { from { opacity: 0; transform: translateY(10px) scale(0.98); } to { opacity: 1; transform: translateY(0) scale(1); } }
.atodo-head { display: flex; align-items: center; justify-content: space-between; padding: 16px 18px; border-bottom: 1px solid var(--rule-2); background: var(--paper-2); }
.atodo-title { display: block; font-weight: 600; font-size: 15px; }
.atodo-sub { font-size: 12px; color: var(--ink-mute); }
.atodo-collapse { width: 28px; height: 28px; border-radius: 8px; color: var(--ink-mute); display: flex; align-items: center; justify-content: center; }
.atodo-collapse:hover { background: var(--paper-3); color: var(--ink); }
.atodo-close { position: absolute; top: 16px; right: 16px; background: none; border: 0; color: var(--ink-soft); cursor: pointer; padding: 6px; border-radius: var(--radius-sm); display: flex; }
.atodo-close:hover { background: var(--paper-2); color: var(--ink); }
.atodo-top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
.atodo-eyebrow { font-size: 11.5px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: var(--signal); }
.atodo-count { font-size: 12px; color: var(--ink-soft); font-variant-numeric: tabular-nums; }
.atodo-title { font-size: 22px; font-weight: 600; color: var(--ink); margin: 0 0 22px; letter-spacing: -.01em; line-height: 1.3; }
.atodo-list { flex: 1; overflow-y: auto; margin: 0 -6px; padding: 0 6px; }
.atodo-item { display: flex; gap: 12px; padding: 14px 16px; border-radius: var(--radius); border: 1px solid var(--rule-2); margin-bottom: 10px; }
.atodo-item.issue { border-left: 2px solid var(--warn); }
.atodo-icon { flex: none; width: 30px; height: 30px; border-radius: 50%; display: flex; align-items: center; justify-content: center; }
.atodo-icon.issue { background: rgba(183,121,31,.12); color: var(--warn); }
.atodo-icon.request { background: var(--signal-soft); color: var(--signal); }
.atodo-item-body { flex: 1; min-width: 0; }
.atodo-item:last-child { margin-bottom: 0; }
.atodo-item-top { display: flex; align-items: center; gap: 8px; margin-bottom: 5px; }
.atodo-badge { font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; padding: 2px 7px; border-radius: 999px; font-weight: 600; }
.atodo-badge.request { background: var(--signal-soft); color: var(--signal); }
.atodo-badge.issue { background: rgba(192,57,43,0.12); color: var(--danger); }
.atodo-item-title { font-size: 14px; font-weight: 600; color: var(--ink); margin: 0 0 4px; }
.atodo-item-desc { font-size: 12.5px; color: var(--ink-soft); line-height: 1.55; margin: 0 0 9px; }
.atodo-action { font-size: 13px; color: var(--signal); font-weight: 500; }
.atodo-action:hover { text-decoration: underline; }
@media (max-width: 820px) { .atodo-panel { max-width: calc(100vw - 24px); } }
</style>
