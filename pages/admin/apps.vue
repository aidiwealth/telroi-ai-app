<template>
  <div>
    <div class="ad-head-row">
      <div>
        <h1 class="ad-title">App releases</h1>
        <p class="ad-sub">The native apps clients see under Apps &amp; Integrations. Update versions, download links and availability here — no deploy needed. This is the distribution list; the actual builds live in the App Store, Play Store or your release bucket.</p>
      </div>
      <button class="btn btn-signal btn-sm" @click="openNew">+ Add app</button>
    </div>

    <div v-if="pending" class="ad-loading">Loading…</div>
    <div v-else class="ad-panel">
      <table class="ad-table">
        <thead><tr><th>App</th><th>Platform</th><th>Group</th><th>Version</th><th>Status</th><th></th></tr></thead>
        <tbody>
          <tr v-for="a in apps" :key="a.id">
            <td>{{ a.name }}</td>
            <td class="ad-dim mono">{{ a.platform }}</td>
            <td class="ad-dim">{{ a.groupLabel }}</td>
            <td class="ad-dim mono">{{ a.version || '—' }}</td>
            <td><span class="ad-tag" :class="a.status === 'available' ? 'ok' : (a.status === 'hidden' ? '' : 'warn')">{{ statusLabel(a.status) }}</span></td>
            <td style="text-align:right">
              <button class="ad-link-btn" @click="openEdit(a)">Edit</button>
              <button class="ad-link-btn ad-link-danger" @click="remove(a)">Delete</button>
            </td>
          </tr>
          <tr v-if="!apps.length"><td colspan="6" class="ad-none">No apps yet. Add one to populate the client Apps tab.</td></tr>
        </tbody>
      </table>
    </div>

    <!-- Add / edit modal -->
    <div v-if="form" class="ad-modal-overlay" @click.self="form = null">
      <div class="ad-modal ad-modal-wide">
        <div class="ad-modal-head"><h3>{{ form.id ? 'Edit app' : 'Add app' }}</h3><button class="ad-x" @click="form = null">✕</button></div>
        <div class="ad-row">
          <div class="ad-field"><label>Name</label><input v-model="form.name" class="ad-input" placeholder="Telroi for iOS" /></div>
          <div class="ad-field"><label>Platform key</label><input v-model="form.platform" class="ad-input mono" placeholder="ios" :disabled="!!form.id" /><span class="ad-hint">Lowercase, unique (ios, android, mac, windows, linux, chrome).</span></div>
        </div>
        <div class="ad-field"><label>Description</label><input v-model="form.description" class="ad-input" placeholder="Make and take calls on your iPhone." /></div>
        <div class="ad-row">
          <div class="ad-field"><label>Group</label><select v-model="form.groupLabel" class="ad-input"><option>Mobile</option><option>Desktop</option><option>Browser</option></select></div>
          <div class="ad-field"><label>Icon</label><select v-model="form.iconKey" class="ad-input"><option value="apple">Apple</option><option value="android">Android</option><option value="windows">Windows</option><option value="linux">Linux</option><option value="browser">Browser</option></select></div>
          <div class="ad-field"><label>Accent</label><input v-model="form.accent" type="color" class="ad-input ad-color" /></div>
        </div>
        <div class="ad-row">
          <div class="ad-field"><label>Version</label><input v-model="form.version" class="ad-input mono" placeholder="2.3.1" /></div>
          <div class="ad-field"><label>Requirement</label><input v-model="form.requirement" class="ad-input" placeholder="iOS 15+" /></div>
          <div class="ad-field"><label>File size</label><input v-model="form.fileSize" class="ad-input" placeholder="48 MB" /></div>
        </div>
        <div class="ad-field"><label>Download URL</label><input v-model="form.downloadUrl" class="ad-input mono" placeholder="https://apps.apple.com/app/telroi" /></div>
        <div class="ad-row">
          <div class="ad-field"><label>Status</label><select v-model="form.status" class="ad-input"><option value="available">Available</option><option value="coming_soon">Coming soon</option><option value="hidden">Hidden</option></select></div>
          <div class="ad-field"><label>Sort order</label><input v-model.number="form.sortOrder" type="number" class="ad-input" /></div>
        </div>
        <button class="btn btn-signal btn-block" :disabled="saving || !form.name || !form.platform" @click="save">{{ saving ? 'Saving…' : 'Save app' }}</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
definePageMeta({ layout: 'admin', middleware: 'superadmin' });
useHead({ title: 'App releases — Telroi Operator' });

const pending = ref(true);
const apps = ref<any[]>([]);
const form = ref<any>(null);
const saving = ref(false);

function statusLabel(s: string) { return s === 'available' ? 'Available' : s === 'coming_soon' ? 'Coming soon' : 'Hidden'; }
function blank() { return { name: '', platform: '', description: '', groupLabel: 'Mobile', iconKey: 'apple', accent: '#0A0A0B', version: '', requirement: '', fileSize: '', downloadUrl: '', status: 'available', sortOrder: (apps.value.length + 1) }; }
function openNew() { form.value = blank(); }
function openEdit(a: any) { form.value = { ...a }; }

async function load() {
  try { apps.value = (await $fetch<any>('/api/admin/apps')).apps || []; }
  catch (e: any) { if (e?.statusCode === 401) await navigateTo('/admin/login'); }
  finally { pending.value = false; }
}
async function save() {
  saving.value = true;
  try {
    const body = { ...form.value };
    if (!body.downloadUrl) delete body.downloadUrl; // avoid empty-string URL validation
    await $fetch('/api/admin/apps/save', { method: 'POST', body });
    form.value = null;
    await load();
  } catch (e: any) { alert(e?.data?.error?.message || 'Could not save'); }
  finally { saving.value = false; }
}
async function remove(a: any) {
  if (!confirm(`Delete ${a.name}? Clients will no longer see it.`)) return;
  try { await $fetch(`/api/admin/apps/${a.id}`, { method: 'DELETE' }); await load(); }
  catch (e: any) { alert(e?.data?.error?.message || 'Could not delete'); }
}
onMounted(load);
</script>

<style scoped>
.ad-head-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 8px; }
.ad-head-row .ad-sub { max-width: 640px; }
.ad-modal-overlay { position: fixed; inset: 0; z-index: 200; background: rgba(10,10,11,0.32); display: flex; align-items: center; justify-content: center; padding: 24px; }
.ad-modal { width: 100%; max-width: 440px; background: var(--paper); border: 1px solid var(--rule); border-radius: var(--radius-lg); padding: 28px; box-shadow: 0 24px 60px rgba(10,10,11,0.28); animation: adModalPop .2s cubic-bezier(.16,1,.3,1); max-height: 90vh; overflow-y: auto; }
.ad-modal-wide { max-width: 640px; }
@keyframes adModalPop { from { opacity: 0; transform: translateY(8px) scale(.98); } to { opacity: 1; transform: translateY(0) scale(1); } }
.ad-modal-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; }
.ad-modal-head h3 { font-family: var(--font-display); font-size: 22px; }
.ad-field { display: flex; flex-direction: column; gap: 6px; margin-bottom: 16px; }
.ad-field label { font-size: 13px; font-weight: 500; }
.ad-input { padding: 11px 14px; border: 1px solid var(--rule); border-radius: var(--radius); font-size: 14.5px; outline: none; background: var(--paper); color: var(--ink); width: 100%; }
.ad-input:focus { border-color: var(--signal); box-shadow: 0 0 0 3px var(--signal-soft); }
.ad-input:disabled { background: var(--paper-2); color: var(--ink-soft); }
.ad-hint { font-size: 11.5px; color: var(--ink-mute); }
.ad-opt { color: var(--ink-mute); font-weight: 400; font-size: 12px; }
.ad-row { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.ad-row:has(> .ad-field:nth-child(3)) { grid-template-columns: 1fr 1fr 1fr; }
.ad-color { height: 40px; padding: 4px; cursor: pointer; }
.ad-table { width: 100%; border-collapse: collapse; }
.ad-table th { text-align: left; font-family: var(--font-mono); font-size: 10.5px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink-mute); font-weight: 500; padding: 12px 16px; border-bottom: 1px solid var(--rule); }
.ad-table td { padding: 12px 16px; border-bottom: 1px solid var(--rule-2); font-size: 14px; }
.ad-link-danger { color: var(--danger); margin-left: 12px; }
.ad-tag.ok { background: rgba(0,210,138,0.12); color: #0a8a5c; }
.ad-tag.warn { background: rgba(200,150,46,0.14); color: #9a6f15; }
</style>
