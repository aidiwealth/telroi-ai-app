<template>
  <!-- Only when there is something to page through. A control that says
       "showing 1–3 of 3" is noise. -->
  <div v-if="total > perPage" class="pg">
    <span class="pg-count">
      Showing {{ from.toLocaleString() }}–{{ to.toLocaleString() }} of {{ total.toLocaleString() }}
    </span>
    <div class="pg-nav">
      <button class="pg-btn" :disabled="page <= 1" @click="go(page - 1)">Previous</button>
      <span class="pg-page">Page {{ page }} of {{ pages }}</span>
      <button class="pg-btn" :disabled="page >= pages" @click="go(page + 1)">Next</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
  page: number;
  pages: number;
  total: number;
  perPage: number;
  /** Where the page number lives in the URL. Sharing a link to page 3 should
   *  land on page 3, and a table that forgets its page on refresh is maddening
   *  when you are working through a long list. */
  queryKey?: string;
}>();
const emit = defineEmits<{ (e: 'change', page: number): void }>();

const route = useRoute();
const router = useRouter();

const from = computed(() => (props.page - 1) * props.perPage + 1);
const to = computed(() => Math.min(props.total, props.page * props.perPage));

function go(p: number) {
  if (p < 1 || p > props.pages) return;
  const key = props.queryKey || 'page';
  router.replace({ query: { ...route.query, [key]: p === 1 ? undefined : String(p) } });
  emit('change', p);
}
</script>

<style scoped>
.pg { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 12px 4px 4px; flex-wrap: wrap; }
.pg-count { font-size: 12.5px; color: var(--ink-soft); }
.pg-nav { display: flex; align-items: center; gap: 10px; }
.pg-page { font-size: 12.5px; color: var(--ink-soft); }
.pg-btn { font-size: 13px; padding: 6px 14px; border: 1px solid var(--rule); border-radius: var(--radius-sm); background: var(--paper); color: var(--ink); cursor: pointer; }
.pg-btn:hover:not(:disabled) { background: var(--paper-2); }
.pg-btn:disabled { opacity: 0.45; cursor: default; }
</style>
