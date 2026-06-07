<template>
  <div v-if="hasMore || loading" class="loadmore">
    <button class="btn btn-ghost btn-sm" :disabled="loading" @click="$emit('more')">
      {{ loading ? 'Loading…' : 'Load more' }}
    </button>
  </div>
  <p v-else-if="showEnd && total" class="loadmore-end">All {{ total }} shown</p>
</template>

<script setup lang="ts">
// Cursor-pagination control. Parent owns the cursor + data; this just emits
// 'more' when clicked. Works with keyset endpoints that return a nextCursor.
defineProps<{ hasMore?: boolean; loading?: boolean; total?: number; showEnd?: boolean }>();
defineEmits<{ more: [] }>();
</script>

<style scoped>
.loadmore { display: flex; justify-content: center; padding: 18px 0; }
.loadmore-end { text-align: center; color: var(--ink-mute); font-size: 12px; padding: 14px 0; }
</style>
