<template>
  <div>
    <h1 class="ad-title">Plan features</h1>
    <p class="ad-sub">Which features each plan unlocks. Changes apply to all clients (per-client overrides are set on each client's page).</p>

    <div v-if="pending" class="ad-loading">Loading…</div>
    <div v-else class="set-card">
      <table class="pf-table">
        <thead>
          <tr><th class="pf-feat">Feature</th><th>Startup</th><th>Growth</th><th>Custom</th></tr>
        </thead>
        <tbody>
          <tr v-for="f in features" :key="f.key">
            <td class="pf-feat">{{ f.label }}</td>
            <td><input type="checkbox" v-model="f.startup" @change="save(f)" /></td>
            <td><input type="checkbox" v-model="f.growth" @change="save(f)" /></td>
            <td><input type="checkbox" v-model="f.custom" @change="save(f)" /></td>
          </tr>
        </tbody>
      </table>
      <span v-if="saved" class="ad-saved">✓ Saved</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
definePageMeta({ layout: 'admin' });
useHead({ title: 'Plan features — Telroi Operator' });

const pending = ref(true);
const features = ref<any[]>([]);
const saved = ref(false);

async function load() {
  pending.value = true;
  try { features.value = (await $fetch<any>('/api/admin/plan-features')).features; }
  catch { await navigateTo('/admin/login'); }
  finally { pending.value = false; }
}
async function save(f: any) {
  try {
    await $fetch('/api/admin/plan-features', { method: 'POST', body: { key: f.key, startup: f.startup, growth: f.growth, custom: f.custom } });
    saved.value = true; setTimeout(() => saved.value = false, 1500);
  } catch (e: any) { alert(e?.data?.error?.message || 'Save failed'); await load(); }
}
onMounted(load);
</script>

<style scoped>
.ad-title { font-family: var(--font-display); font-size: 30px; color: var(--ink); letter-spacing: -0.02em; }
.ad-sub { color: var(--ink-mute); font-size: 14px; margin: 4px 0 24px; }
.ad-loading { color: var(--ink-mute); padding: 40px 0; }
.set-card { background: var(--paper); border: 1px solid var(--rule); border-radius: var(--radius-lg); padding: 12px 24px 20px; max-width: 640px; }
.pf-table { width: 100%; border-collapse: collapse; }
.pf-table th { text-align: center; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--ink-mute); font-weight: 500; padding: 14px 8px; border-bottom: 1px solid var(--rule); }
.pf-table th.pf-feat { text-align: left; }
.pf-table td { text-align: center; padding: 11px 8px; border-bottom: 1px solid var(--rule-2); font-size: 13.5px; color: var(--ink); }
.pf-table tr:last-child td { border-bottom: none; }
.pf-feat { text-align: left; }
.pf-table input[type=checkbox] { width: 16px; height: 16px; accent-color: var(--signal); cursor: pointer; }
.ad-saved { color: #0a8a5c; font-size: 13px; display: inline-block; margin-top: 12px; }
</style>
