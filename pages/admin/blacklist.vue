<template>
  <div>
    <h1 class="ad-title">Blocked numbers</h1>
    <p class="ad-sub">Every client's blocked numbers, across all workspaces. Each client manages their own private list; this is the combined operator view. Calls to a blocked number are refused on every carrier.</p>

    <div v-if="pending" class="ad-loading">Loading…</div>
    <EmptyState v-else-if="!items.length" icon="shield" title="No blocked numbers" description="When clients (or operators) block numbers, they'll appear here grouped by workspace." />
    <div v-else>
      <div class="ad-bl-toolbar">
        <input v-model="q" class="ad-input" placeholder="Search by number, reason or client…" />
        <span class="ad-bl-total">{{ filtered.length }} of {{ items.length }} blocked</span>
      </div>
      <table class="ad-table">
        <thead><tr><th>Number</th><th>Client</th><th>Reason</th><th>Added</th></tr></thead>
        <tbody>
          <tr v-for="b in filtered" :key="b.id">
            <td class="mono">{{ b.telnum }}</td>
            <td>
              <NuxtLink v-if="b.clientSlug" :to="`/admin/clients/${b.clientSlug}`" class="ad-link-btn">{{ b.clientName || '—' }}</NuxtLink>
              <span v-else class="ad-dim">{{ b.clientName || '—' }}</span>
            </td>
            <td class="ad-dim">{{ b.comment || '—' }}</td>
            <td class="ad-dim">{{ fmt(b.createdAt) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
definePageMeta({ layout: 'admin' });
useHead({ title: 'Blocked numbers — Telroi Operator' });

const pending = ref(true);
const items = ref<any[]>([]);
const q = ref('');

const filtered = computed(() => {
  const s = q.value.trim().toLowerCase();
  if (!s) return items.value;
  return items.value.filter((b) =>
    (b.telnum || '').toLowerCase().includes(s) ||
    (b.comment || '').toLowerCase().includes(s) ||
    (b.clientName || '').toLowerCase().includes(s)
  );
});

function fmt(d: string) { try { return new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); } catch { return d; } }

onMounted(async () => {
  try { const r = await $fetch<any>('/api/admin/blacklist'); items.value = r.items || []; }
  catch (e: any) { if (e?.statusCode === 401) await navigateTo('/admin/login'); }
  finally { pending.value = false; }
});
</script>

<style scoped>
.ad-bl-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 14px; }
.ad-bl-toolbar .ad-input { max-width: 360px; }
.ad-bl-total { font-size: 13px; color: var(--ink-mute); white-space: nowrap; }
</style>
