<template>
  <div>
    <div class="ad-head-row">
      <div>
        <h1 class="ad-title">Audit log</h1>
        <p class="ad-sub">Every change made in the operator console, attributed to the operator who made it. Search by name, action, or area.</p>
      </div>
    </div>

    <div class="aud-filters">
      <div class="aud-search">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="7" cy="7" r="5"/><path d="M11 11l3.5 3.5" stroke-linecap="round"/></svg>
        <input v-model="q" class="aud-input" placeholder="Search actor, action, or path…" @input="debouncedLoad" />
      </div>
      <select v-model="actor" class="aud-select" @change="load">
        <option value="">All operators</option>
        <option v-for="a in actors" :key="a" :value="a">{{ a }}</option>
      </select>
    </div>

    <div v-if="pending" class="ad-loading">Loading…</div>
    <template v-else>
      <div class="ad-panel">
        <table class="ad-table aud-table">
          <thead><tr><th>When</th><th>Operator</th><th>Action</th><th>Path</th><th>Result</th></tr></thead>
          <tbody>
            <tr v-for="e in entries" :key="e.id">
              <td class="ad-dim mono">{{ fmt(e.createdAt) }}</td>
              <td><strong>{{ e.actorEmail }}</strong><span v-if="e.actorRole" class="aud-role" :class="e.actorRole">{{ e.actorRole }}</span></td>
              <td class="mono">{{ e.action }}</td>
              <td class="ad-dim mono aud-path">{{ e.method }} {{ e.path }}</td>
              <td><span class="aud-status" :class="statusClass(e.status)">{{ e.status || '—' }}</span></td>
            </tr>
            <tr v-if="!entries.length"><td colspan="5" class="ad-none">No audit entries match.</td></tr>
          </tbody>
        </table>
      </div>
      <div v-if="entries.length >= 50" class="aud-more">
        <button class="btn btn-ghost" @click="loadMore">Load older entries</button>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
definePageMeta({ layout: 'admin', middleware: 'superadmin' });
useHead({ title: 'Audit log — Telroi Operator' });

const pending = ref(true);
const entries = ref<any[]>([]);
const actors = ref<string[]>([]);
const q = ref('');
const actor = ref('');
let timer: any = null;

function fmt(iso: string) { return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }
function statusClass(s: number) { if (!s) return 'mute'; if (s < 300) return 'ok'; if (s < 500) return 'warn'; return 'err'; }

async function load() {
  pending.value = true;
  try {
    const params = new URLSearchParams();
    if (q.value.trim()) params.set('q', q.value.trim());
    if (actor.value) params.set('actor', actor.value);
    const r = await $fetch<any>(`/api/admin/audit?${params.toString()}`);
    entries.value = r.entries || [];
    if (r.actors?.length) actors.value = r.actors;
  } catch (e: any) {
    if (e?.statusCode === 401) await navigateTo('/admin/login');
    if (e?.statusCode === 403) await navigateTo('/admin'); // staff can't view audit
  } finally { pending.value = false; }
}
function debouncedLoad() { clearTimeout(timer); timer = setTimeout(load, 300); }
async function loadMore() {
  const last = entries.value[entries.value.length - 1];
  if (!last) return;
  const params = new URLSearchParams();
  if (q.value.trim()) params.set('q', q.value.trim());
  if (actor.value) params.set('actor', actor.value);
  params.set('before', last.createdAt);
  try { const r = await $fetch<any>(`/api/admin/audit?${params.toString()}`); entries.value.push(...(r.entries || [])); }
  catch { /* */ }
}
onMounted(load);
</script>

<style scoped>
.ad-head-row { margin-bottom: 18px; }
.aud-filters { display: flex; gap: 12px; margin-bottom: 18px; flex-wrap: wrap; }
.aud-search { position: relative; flex: 1; min-width: 240px; display: flex; align-items: center; }
.aud-search svg { position: absolute; left: 12px; width: 15px; height: 15px; color: var(--ink-mute); }
.aud-input { width: 100%; padding: 10px 14px 10px 34px; border: 1px solid var(--rule); border-radius: var(--radius); font-size: 14px; outline: none; background: var(--paper); color: var(--ink); }
.aud-input:focus { border-color: var(--signal); box-shadow: 0 0 0 3px var(--signal-soft); }
.aud-select { padding: 10px 14px; border: 1px solid var(--rule); border-radius: var(--radius); font-size: 14px; background: var(--paper); color: var(--ink); cursor: pointer; }
.ad-panel { background: var(--paper); border: 1px solid var(--rule); border-radius: var(--radius-lg); overflow: hidden; }
.ad-table { width: 100%; border-collapse: collapse; }
.ad-table th { text-align: left; font-family: var(--font-mono); font-size: 10.5px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink-mute); font-weight: 500; padding: 12px 18px; border-bottom: 1px solid var(--rule); }
.ad-table td { padding: 12px 18px; border-bottom: 1px solid var(--rule-2); font-size: 13.5px; vertical-align: middle; }
.aud-role { font-size: 10.5px; padding: 1px 7px; border-radius: 999px; margin-left: 8px; }
.aud-role.superadmin { background: rgba(26,75,114,0.12); color: var(--signal); }
.aud-role.staff { background: rgba(138,138,147,0.16); color: #6b6b73; }
.aud-path { font-size: 12.5px; }
.aud-status { font-family: var(--font-mono); font-size: 12px; font-weight: 600; padding: 2px 8px; border-radius: 6px; }
.aud-status.ok { background: rgba(0,210,138,0.12); color: #0a8a5c; }
.aud-status.warn { background: rgba(200,150,46,0.14); color: #9a6f15; }
.aud-status.err { background: rgba(192,57,43,0.12); color: #c0392b; }
.aud-status.mute { color: var(--ink-mute); }
.mono { font-family: var(--font-mono); }
.ad-dim { color: var(--ink-mute); }
.ad-none { text-align: center; color: var(--ink-mute); padding: 22px; }
.ad-loading { padding: 30px; text-align: center; color: var(--ink-mute); }
.aud-more { text-align: center; margin-top: 16px; }
.ad-title { font-family: var(--font-display); font-size: 26px; }
.ad-sub { color: var(--ink-mute); font-size: 14px; margin-top: 4px; }
</style>
