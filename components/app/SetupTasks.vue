<template>
  <div v-if="tasks.length">
    <!-- Docked: a slim tab on the right edge until they open it. -->
    <div v-if="collapsed" class="todo-dock">
      <button class="edge-tab" @click="setCollapsed(false)" :title="`${tasks.length} setup ${tasks.length === 1 ? 'task' : 'tasks'}`">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
        <span>Tasks</span>
        <span class="edge-tab-count">{{ tasks.length }}</span>
      </button>
    </div>

    <!-- Open: one thing to do, not a list of everything undone. A backlog makes
         setup feel long; a single next step makes it feel close. -->
    <div v-else class="st-overlay" @click.self="setCollapsed(true)">
      <div class="st-panel" role="dialog" aria-modal="true" aria-labelledby="st-title">
        <button class="st-close" @click="setCollapsed(true)" aria-label="Close">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
        </button>

        <div class="st-top">
          <span class="st-eyebrow">{{ current.owner === 'client' ? 'Next up' : 'In progress' }}</span>
          <span v-if="stepLabel" class="st-step">{{ stepLabel }}</span>
        </div>

        <div class="st-body">
          <span class="st-icon" :class="current.owner">
            <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
              <template v-if="current.owner === 'admin'"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></template>
              <template v-else-if="current.owner === 'support'"><circle cx="12" cy="12" r="9"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3"/><path d="M12 17h.01"/></template>
              <template v-else-if="current.icon === 'credit-card'"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/></template>
              <template v-else-if="current.icon === 'wallet'"><path d="M19 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0 0 4h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5"/><path d="M17 12h.01"/></template>
              <template v-else-if="current.icon === 'plug-connected'"><path d="M7 12h10"/><path d="M9 8V5M15 8V5"/><path d="M9 12v3a3 3 0 0 0 6 0v-3"/><path d="M12 18v3"/></template>
              <template v-else-if="current.icon === 'robot'"><rect x="4" y="8" width="16" height="12" rx="2"/><path d="M12 4v4"/><path d="M9 13h.01M15 13h.01"/><path d="M9 17h6"/></template>
              <template v-else><path d="M3 5h14"/><path d="M17 9l4 3-4 3"/><path d="M3 12h18"/></template>
            </svg>
          </span>
          <h2 id="st-title" class="st-title">{{ current.title }}</h2>
          <p class="st-desc">{{ current.desc }}</p>

          <NuxtLink v-if="current.owner === 'client' && current.action" :to="current.action.to" class="btn btn-signal st-cta" @click="setCollapsed(true)">
            {{ current.action.label }}
          </NuxtLink>
          <a v-else-if="current.owner === 'support'" :href="supportMailto(current)" class="btn btn-signal st-cta">Contact support</a>
          <p v-else class="st-waiting">Nothing needed from you — we're on it.</p>
        </div>

        <div v-if="progress.total" class="st-progress">
          <div class="st-bar"><div class="st-bar-fill" :style="{ width: `${(progress.completed / progress.total) * 100}%` }" /></div>
        </div>

        <p class="st-rest">{{ restLine }}</p>
        <a :href="supportMailto()" class="st-help">Need help? {{ supportEmail }}</a>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
const api = useApi();

const tasks = ref<any[]>([]);
const progress = ref<{ completed: number; total: number }>({ completed: 0, total: 0 });
const supportEmail = ref('support@telroi.ai');
const COLLAPSE_KEY = 'telroi_setup_tasks_collapsed';
const collapsed = ref(true);

// Theirs first: opening on something they can't act on reads as a wall.
const current = computed(() => tasks.value.find((t) => t.owner === 'client') || tasks.value[0] || {});

const stepLabel = computed(() => {
  const { completed, total } = progress.value;
  if (!total || current.value.owner !== 'client') return '';
  return `Step ${Math.min(completed + 1, total)} of ${total}`;
});

const restLine = computed(() => {
  const mine = tasks.value.filter((t) => t.owner === 'client').length;
  const ours = tasks.value.filter((t) => t.owner !== 'client').length;
  const parts: string[] = [];
  if (mine > 1) parts.push(`${mine - 1} more after this`);
  if (ours) parts.push(`${ours} we're handling`);
  return parts.join(' · ') || 'This is the last one.';
});

function setCollapsed(v: boolean) {
  collapsed.value = v;
  if (import.meta.client) {
    try { localStorage.setItem(COLLAPSE_KEY, v ? '1' : '0'); } catch { /* ignore */ }
  }
}

function supportMailto(t?: any) {
  const subj = encodeURIComponent(t ? `Help with: ${t.title}` : 'Telroi support request');
  return `mailto:${supportEmail.value}?subject=${subj}`;
}

async function load() {
  try {
    const r = await api.get<any>('/api/tenant/setup-tasks');
    tasks.value = r.tasks || [];
    progress.value = r.progress || { completed: 0, total: 0 };
    supportEmail.value = r.supportEmail || 'support@telroi.ai';
  } catch { /* nothing to show */ }
}

onMounted(async () => {
  // Docked by default — Copilot already opens on the dashboard, and two things
  // asking for attention at once makes a poor first impression.
  try { collapsed.value = localStorage.getItem(COLLAPSE_KEY) !== '0'; } catch { collapsed.value = true; }
  await load();
});
</script>

<style scoped>
/* Sits above Copilot, mirrored about centre, so the two read as a pair of docked
   tabs rather than two things that happen to share an edge. */
.todo-dock { position: fixed; right: 0; top: calc(50% - 52px); z-index: 89; }
.edge-tab { display: flex; align-items: center; gap: 7px; padding: 10px 12px 10px 14px; border: none; border-radius: 12px 0 0 12px; background: var(--signal, #1a4b72); color: #fff; cursor: pointer; box-shadow: 0 4px 16px rgba(0,0,0,0.18); font-size: 13px; font-weight: 600; }
.edge-tab svg { width: 18px; height: 18px; }
.edge-tab:hover { filter: brightness(1.08); }
.edge-tab-count { font-size: 11px; font-weight: 600; background: rgba(255,255,255,.22); color: #fff; border-radius: 999px; min-width: 17px; padding: 1px 6px; text-align: center; }

.st-overlay { position: fixed; inset: 0; z-index: 200; background: rgba(10,10,11,.5); backdrop-filter: blur(3px); display: flex; align-items: center; justify-content: center; padding: 24px; }
.st-panel { position: relative; width: 100%; max-width: 560px; background: var(--paper); border: 1px solid var(--rule); border-radius: var(--radius-lg); padding: 40px 44px 28px; box-shadow: 0 24px 60px rgba(10,10,11,.22); }
.st-close { position: absolute; top: 16px; right: 16px; background: none; border: 0; color: var(--ink-soft); cursor: pointer; padding: 6px; border-radius: var(--radius-sm); display: flex; }
.st-close:hover { background: var(--paper-2); color: var(--ink); }

.st-top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 26px; }
.st-eyebrow { font-size: 11.5px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: var(--signal); }
.st-step { font-size: 12px; color: var(--ink-soft); font-variant-numeric: tabular-nums; }

.st-body { text-align: center; }
.st-icon { display: inline-flex; align-items: center; justify-content: center; width: 60px; height: 60px; border-radius: 50%; margin-bottom: 20px; }
.st-icon.client { background: var(--signal-soft); color: var(--signal); }
.st-icon.admin { background: rgba(183,121,31,.12); color: var(--warn); }
.st-icon.support { background: var(--paper-3); color: var(--ink-soft); }
.st-title { font-size: 22px; font-weight: 600; color: var(--ink); margin: 0 0 10px; letter-spacing: -.01em; line-height: 1.3; }
.st-desc { font-size: 14.5px; color: var(--ink-soft); line-height: 1.6; margin: 0 auto 24px; max-width: 40ch; }
.st-cta { display: inline-block; padding: 11px 26px; font-size: 14.5px; font-weight: 600; border-radius: var(--radius); text-decoration: none; }
.st-waiting { font-size: 13.5px; color: var(--ink-soft); margin: 0; font-style: italic; }

.st-progress { margin: 30px 0 12px; }
.st-bar { height: 3px; background: var(--paper-2); border-radius: 2px; overflow: hidden; }
.st-bar-fill { height: 100%; background: var(--signal); border-radius: 2px; transition: width .3s ease; }

.st-rest { font-size: 12px; color: var(--ink-soft); text-align: center; margin: 0 0 18px; }
.st-help { display: block; text-align: center; font-size: 12px; color: var(--ink-soft); text-decoration: none; padding-top: 14px; border-top: 1px solid var(--rule); }
.st-help:hover { color: var(--signal); }

@media (max-width: 560px) {
  .st-panel { padding: 34px 24px 24px; }
  .st-title { font-size: 19px; }
}
</style>
