<template>
  <button class="export-btn" :disabled="busy" :title="`Export the last 30 days as CSV`" @click="run">
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M12 15l-4-4M12 15l4-4"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg>
    {{ busy ? 'Exporting…' : label }}
  </button>
</template>

<script setup lang="ts">
import { ref } from 'vue';
const props = defineProps<{ url: string; label?: string; filename?: string }>();
const label = props.label || 'Export';
const busy = ref(false);

async function run() {
  busy.value = true;
  try {
    // Credentialed fetch (session cookie) → blob → client-side download.
    const res = await fetch(props.url, { credentials: 'include' });
    if (!res.ok) throw new Error(`Export failed (${res.status})`);
    const blob = await res.blob();
    const a = document.createElement('a');
    const objUrl = URL.createObjectURL(blob);
    a.href = objUrl;
    a.download = props.filename || guessName(res) || 'export.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(objUrl);
  } catch (e: any) {
    // Surface a lightweight alert; pages may also have their own toast.
    alert(e?.message || 'Could not export');
  } finally {
    busy.value = false;
  }
}

function guessName(res: Response): string | null {
  const cd = res.headers.get('Content-Disposition') || '';
  const m = cd.match(/filename="?([^"]+)"?/);
  return m ? m[1] : null;
}
</script>

<style scoped>
.export-btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 7px 14px; font-size: 13px; border-radius: var(--radius-sm);
  border: 1px solid var(--rule); color: var(--ink-soft); background: var(--paper);
  transition: border-color 0.14s, color 0.14s;
}
.export-btn:hover:not(:disabled) { border-color: var(--ink-soft); color: var(--ink); }
.export-btn:disabled { opacity: 0.6; cursor: default; }
</style>
