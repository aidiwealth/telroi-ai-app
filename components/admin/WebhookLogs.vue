<template>
  <div>

    <div v-if="pending" class="ad-loading">Loading…</div>

    <template v-else>
      <div class="wl-stats">
        <div v-for="s in summary" :key="s.outcome" class="wl-stat" :class="s.outcome">
          <span class="wl-stat-n">{{ s.n }}</span>
          <span class="wl-stat-l">{{ s.outcome }}</span>
        </div>
      </div>

      <div class="wl-filters">
        <select v-model="filters.provider" class="wl-select" @change="load">
          <option value="">All providers</option>
          <option value="monnify">Monnify</option>
          <option value="paystack">Paystack</option>
          <option value="stripe">Stripe</option>
        </select>
        <select v-model="filters.outcome" class="wl-select" @change="load">
          <option value="">All outcomes</option>
          <option value="accepted">Accepted</option>
          <option value="rejected">Rejected</option>
          <option value="ignored">Ignored</option>
          <option value="error">Error</option>
        </select>
      </div>

      <EmptyState v-if="!events.length" icon="generic" title="Nothing recorded yet" description="Notifications appear here as providers send them." />
      <!-- ad-data-table and set-card are global; ad-table and ad-panel are
           defined inside audit.vue's scoped styles, so borrowing those names
           gave the markup and none of the styling. -->
      <div v-else class="set-card ad-table-wrap">
        <table class="ad-data-table wl-table">
          <thead><tr><th>Provider</th><th>Outcome</th><th>Workspace</th><th>Detail</th><th>When</th></tr></thead>
          <tbody>
            <tr v-for="e in events" :key="e.id" class="wl-row" @click="open = open === e.id ? null : e.id">
              <td>{{ e.provider }}</td>
              <td><span class="wl-badge" :class="e.outcome">{{ e.outcome }}</span></td>
              <td class="ad-dim">{{ e.workspace || '—' }}</td>
              <td class="ad-dim">{{ e.detail || '—' }}</td>
              <td class="ad-dim mono">{{ fmt(e.createdAt) }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-if="openEvent" class="wl-body">
        <h3 class="ad-panel-h">What they sent</h3>
        <pre class="wl-pre">{{ openEvent.bodyExcerpt || 'No body recorded.' }}</pre>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue';

const events = ref<any[]>([]);
const summary = ref<any[]>([]);
const pending = ref(true);
const open = ref<string | null>(null);
const filters = reactive({ provider: '', outcome: '' });

const openEvent = computed(() => events.value.find((e) => e.id === open.value) || null);

function fmt(d: string) { return new Date(d).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }

async function load() {
  pending.value = true;
  try {
    const q = new URLSearchParams();
    if (filters.provider) q.set('provider', filters.provider);
    if (filters.outcome) q.set('outcome', filters.outcome);
    const r = await $fetch<any>(`/api/admin/webhook-log?${q}`);
    events.value = r.events || [];
    summary.value = r.summary || [];
  } catch (e: any) {
    if (e?.statusCode === 401) await navigateTo('/admin/login');
  } finally { pending.value = false; }
}

onMounted(load);
</script>

<style scoped>
.wl-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap: 12px; margin-bottom: 18px; }
.wl-stat { background: var(--paper); border: 1px solid var(--rule); border-radius: var(--radius); padding: 14px 16px; display: flex; flex-direction: column; gap: 4px; }
.wl-stat-n { font-size: 22px; font-weight: 600; font-variant-numeric: tabular-nums; }
.wl-stat-l { font-size: 12px; color: var(--ink-soft); text-transform: capitalize; }
.wl-stat.rejected .wl-stat-n, .wl-stat.error .wl-stat-n { color: #a33; }
.wl-stat.accepted .wl-stat-n { color: #1c7a49; }
.wl-filters { display: flex; gap: 12px; margin-bottom: 18px; flex-wrap: wrap; }
.wl-select { padding: 10px 14px; border: 1px solid var(--rule); border-radius: var(--radius); font-size: 14px; background: var(--paper); color: var(--ink); cursor: pointer; }
.wl-table td { vertical-align: top; }
.wl-row { cursor: pointer; }
.wl-badge { font-size: 11.5px; padding: 2px 8px; border-radius: 999px; background: var(--paper-2); color: var(--ink-soft); text-transform: capitalize; }
.wl-badge.accepted { background: rgba(34,139,84,.12); color: #1c7a49; }
.wl-badge.rejected, .wl-badge.error { background: rgba(180,45,45,.12); color: #a33; }
.wl-body { margin-top: 20px; }
.wl-pre { background: var(--paper-2); border-radius: var(--radius); padding: 14px 16px; font-size: 12px; overflow-x: auto; white-space: pre-wrap; word-break: break-all; }
</style>
