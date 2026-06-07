<template>
  <div v-if="tasks.length">
    <div v-if="collapsed" class="atodo-dock">
      <button class="edge-tab" @click="setCollapsed(false)" :title="`${tasks.length} ${tasks.length === 1 ? 'task' : 'tasks'} to handle`">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
        <span class="edge-tab-count">{{ tasks.length }}</span>
      </button>
    </div>

    <div v-else class="atodo-overlay" @click.self="setCollapsed(true)">
      <div class="atodo-panel">
        <div class="atodo-head">
          <div>
            <span class="atodo-title">Action queue</span>
            <span class="atodo-sub">{{ tasks.length }} to handle</span>
          </div>
          <button class="atodo-collapse" @click="setCollapsed(true)" title="Close">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        </div>

        <div class="atodo-list">
          <div v-for="t in tasks" :key="t.id" class="atodo-item">
            <div class="atodo-item-top">
              <span class="atodo-badge" :class="t.kind">{{ t.kind === 'issue' ? 'Issue' : 'Request' }}</span>
              <span class="atodo-item-title">{{ t.title }}</span>
            </div>
            <p class="atodo-item-desc">{{ t.desc }}</p>
            <NuxtLink v-if="t.action" :to="t.action.to" class="atodo-action" @click="setCollapsed(true)">{{ t.action.label }} →</NuxtLink>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';

const tasks = ref<any[]>([]);
const COLLAPSE_KEY = 'telroi_admin_tasks_collapsed';
const collapsed = ref(false);
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
    try { if (localStorage.getItem(COLLAPSE_KEY) === '1') collapsed.value = true; } catch { /* ignore */ }
  }
  load();
});
const router = useRouter();
router.afterEach(() => { load(); });
</script>

<style scoped>
.atodo-dock { position: fixed; right: 0; top: 50%; transform: translateY(-50%); z-index: 90; }
.edge-tab {
  display: flex; flex-direction: column; align-items: center; gap: 4px;
  width: 46px; box-sizing: border-box;
  background: var(--signal); color: #fff; padding: 12px 10px;
  border-radius: 12px 0 0 12px; box-shadow: -4px 4px 16px rgba(10,10,11,0.16);
  cursor: pointer;
}
.edge-tab-count { font-size: 12px; font-weight: 600; background: rgba(255,255,255,0.22); border-radius: 999px; min-width: 18px; height: 18px; display: flex; align-items: center; justify-content: center; }
.atodo-overlay {
  position: fixed; inset: 0; z-index: 200; background: rgba(10,10,11,0.32);
  display: flex; align-items: center; justify-content: center; padding: 24px;
  animation: atodo-fade 0.16s ease;
}
@keyframes atodo-fade { from { opacity: 0; } to { opacity: 1; } }
.atodo-panel {
  width: 100%; max-width: 380px; max-height: 80vh; display: flex; flex-direction: column;
  background: var(--paper); border: 1px solid var(--rule); border-radius: var(--radius-lg);
  box-shadow: 0 24px 60px rgba(10,10,11,0.28); overflow: hidden;
  animation: atodo-in 0.18s cubic-bezier(0.16,1,0.3,1);
}
@keyframes atodo-in { from { opacity: 0; transform: translateY(10px) scale(0.98); } to { opacity: 1; transform: translateY(0) scale(1); } }
.atodo-head { display: flex; align-items: center; justify-content: space-between; padding: 16px 18px; border-bottom: 1px solid var(--rule-2); background: var(--paper-2); }
.atodo-title { display: block; font-weight: 600; font-size: 15px; }
.atodo-sub { font-size: 12px; color: var(--ink-mute); }
.atodo-collapse { width: 28px; height: 28px; border-radius: 8px; color: var(--ink-mute); display: flex; align-items: center; justify-content: center; }
.atodo-collapse:hover { background: var(--paper-3); color: var(--ink); }
.atodo-list { flex: 1; overflow-y: auto; padding: 10px; }
.atodo-item { padding: 12px; border-radius: var(--radius); border: 1px solid var(--rule-2); margin-bottom: 8px; }
.atodo-item:last-child { margin-bottom: 0; }
.atodo-item-top { display: flex; align-items: center; gap: 8px; margin-bottom: 5px; }
.atodo-badge { font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; padding: 2px 7px; border-radius: 999px; font-weight: 600; }
.atodo-badge.request { background: var(--signal-soft); color: var(--signal); }
.atodo-badge.issue { background: rgba(192,57,43,0.12); color: var(--danger); }
.atodo-item-title { font-size: 13.5px; font-weight: 500; }
.atodo-item-desc { font-size: 12.5px; color: var(--ink-soft); line-height: 1.45; margin-bottom: 8px; }
.atodo-action { font-size: 13px; color: var(--signal); font-weight: 500; }
.atodo-action:hover { text-decoration: underline; }
@media (max-width: 820px) { .atodo-panel { max-width: calc(100vw - 24px); } }
</style>
