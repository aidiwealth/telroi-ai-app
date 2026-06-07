<template>
  <div>
    <div class="ad-head">
      <div>
        <h1 class="ad-title">Clients</h1>
        <p class="ad-sub">Every workspace on Telroi, by product.</p>
      </div>
      <div class="ad-head-right">
        <input v-model="search" class="ad-search" placeholder="Search name or subdomain…" @keyup.enter="reload" />
        <button class="btn btn-signal btn-sm" @click="subdomainEdited = false; showCreate = true">+ New client</button>
      </div>
    </div>

    <div v-if="!error && clients.length" class="ad-filters">
      <button class="ad-filter" :class="{ on: filter === 'all' }" @click="filter = 'all'">All</button>
      <button v-for="p in planKeys" :key="p" class="ad-filter" :class="{ on: filter === p }" @click="filter = p">
        {{ planLabel(p) }}
      </button>
    </div>

    <div v-if="pending" class="ad-loading">Loading clients…</div>
    <div v-else-if="error" class="ad-error">
      {{ error }}
      <NuxtLink to="/admin/settings" class="ad-error-link">Configure the Operator API →</NuxtLink>
    </div>

    <div v-else-if="filtered.length" class="ad-table-wrap">
      <table class="ad-table">
        <thead>
          <tr>
            <th>Client</th><th>Domain</th><th>Plan</th>
            <th class="ad-c">Numbers</th><th class="ad-c">Wallet</th><th>Status</th><th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in filtered" :key="c.tenantId">
            <td class="ad-name">{{ c.name }}</td>
            <td class="mono ad-dim">{{ c.domain }}</td>
            <td>
              <span class="ad-plan" :class="c.plan">{{ planLabel(c.plan) }}</span>
              <span v-if="c.onTrial" class="ad-trial">trial</span>
              <span class="ad-mode" :class="c.sandbox ? 'sandbox' : 'live'">{{ c.sandbox ? 'Sandbox' : 'Live' }}</span>
            </td>
            <td class="ad-c ad-dim mono">{{ c.counts.numbers || '–' }}</td>
            <td class="ad-c ad-dim mono">{{ c.walletCurrency === 'NGN' ? '₦' : '$' }}{{ (c.walletMinor / 100).toFixed(2) }}</td>
            <td>
              <span v-if="c.provisioned" class="ad-status-pill ok">Live</span>
              <span v-else class="ad-status-pill pending">Activating</span>
            </td>
            <td class="ad-row-actions">
              <NuxtLink :to="`/admin/clients/${encodeURIComponent(c.domain)}`" class="btn btn-ghost btn-sm">Details</NuxtLink>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <EmptyState v-else icon="agents" title="No clients match this filter" description="Try a different search or filter to find a workspace." />

    <div v-if="!pending && !error && totalPages > 1" class="ad-pager">
      <button class="btn btn-ghost btn-sm" :disabled="page <= 1" @click="goPage(page - 1)">← Prev</button>
      <span class="ad-pager-info">Page {{ page }} of {{ totalPages }} · {{ total }} clients</span>
      <button class="btn btn-ghost btn-sm" :disabled="page >= totalPages" @click="goPage(page + 1)">Next →</button>
    </div>

    <div v-if="showCreate" class="ad-modal-overlay" @click.self="showCreate = false">
      <div class="ad-modal">
        <div class="ad-modal-head"><h3>New client</h3><button class="ad-x" @click="showCreate = false">✕</button></div>
        <div class="ad-field"><label>Client name</label><input v-model="draft.client" class="ad-input" placeholder="Acme Corp" @input="deriveSubdomain" /></div>
        <div class="ad-field">
          <label>Subdomain</label>
          <div class="ad-slug"><input v-model="draft.subdomain" class="ad-input mono" placeholder="acme" @input="subdomainEdited = true" /><span class="ad-suffix mono">.{{ suffix }}</span></div>
          <span class="ad-hint">Auto-filled from the first word of the client name. Edit if you need something different.</span>
        </div>
        <div class="ad-row">
          <div class="ad-field">
            <label>Country</label>
            <select v-model="draft.country" class="ad-input">
              <option value="">— Select —</option>
              <option v-for="c in countryOptions" :key="c" :value="c">{{ c }}</option>
            </select>
            <span class="ad-hint">Sets billing currency ({{ draft.country === 'Nigeria' ? '₦ Naira' : '$ USD' }}) and routing region.</span>
          </div>
          <div class="ad-field">
            <label>Starting plan</label>
            <select v-model="draft.plan" class="ad-input">
              <option value="startup">Startup</option>
              <option value="growth">Growth</option>
            </select>
            <span class="ad-hint">Begins a {{ 7 }}-day trial of the chosen plan.</span>
          </div>
        </div>
        <div class="ad-row">
          <div class="ad-field"><label>Sector <span class="ad-opt">(optional)</span></label><input v-model="draft.sector" class="ad-input" placeholder="e.g. Fintech" /></div>
          <div class="ad-field"><label>Business phone <span class="ad-opt">(optional)</span></label><input v-model="draft.businessPhone" class="ad-input mono" placeholder="+234…" /></div>
        </div>
        <div class="ad-row">
          <div class="ad-field"><label>Seats</label><input v-model.number="draft.accountsLimit" type="number" class="ad-input" /></div>
          <div class="ad-field"><label>Lines</label><input v-model.number="draft.maxLines" type="number" class="ad-input" /></div>
        </div>
        <label class="ad-check">
          <input type="checkbox" v-model="draft.provisionNow" />
          <span>Provision carrier now <span class="ad-opt">— otherwise the workspace stays local and is provisioned at go-live (recommended)</span></span>
        </label>
        <button class="btn btn-signal btn-block" :disabled="creating || !draft.client || !draft.subdomain || !draft.country" @click="create">
          {{ creating ? (draft.provisionNow ? 'Provisioning…' : 'Creating…') : 'Create client' }}
        </button>
        <p class="ad-note">Creates the client workspace, sets its currency from country, and starts the plan trial. Carrier provisioning happens at go-live unless you opt in above.</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue';
definePageMeta({ layout: 'admin' });
useHead({ title: 'Clients — Telroi Operator' });

interface Client { domain: string; name: string; slug: string; tenantId: string; provisioned: boolean; walletMinor: number; walletCurrency: string; products: Record<string, boolean>; counts: Record<string, number>; }

const pending = ref(true);
const error = ref('');
const clients = ref<Client[]>([]);
const suffix = ref('digitaltide.io');
const filter = ref('all');
const showCreate = ref(false);
const creating = ref(false);
const draft = reactive({ client: '', subdomain: '', country: '', sector: '', businessPhone: '', plan: 'startup', accountsLimit: 10, maxLines: 5, provisionNow: false });
const countryOptions = ['Nigeria', 'Ghana', 'Kenya', 'South Africa', 'United States', 'Canada', 'United Kingdom', 'Germany', 'France', 'United Arab Emirates', 'India', 'Other'];
const subdomainEdited = ref(false);
const search = ref('');
const page = ref(1);
const total = ref(0);
const totalPages = ref(1);

// Mirror the client-onboarding rule: subdomain = first word of the name only
// (e.g. "Acme Corp Ltd" -> "acme"). Stops auto-filling once the operator types
// their own subdomain.
function deriveSubdomain() {
  if (subdomainEdited.value) return;
  const firstWord = draft.client.trim().split(/\s+/)[0] || '';
  draft.subdomain = firstWord.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 40);
}

const planKeys = ['startup', 'growth', 'custom'];
function planLabel(p: string) { return ({ startup: 'Startup', growth: 'Growth', custom: 'Custom' } as any)[p] || p; }
function planCount(p: string) { return clients.value.filter((c) => c.plan === p).length; }
const filtered = computed(() => filter.value === 'all' ? clients.value : clients.value.filter((c) => c.plan === filter.value));

async function load() {
  pending.value = true; error.value = '';
  try {
    const params = new URLSearchParams({ page: String(page.value), pageSize: '50' });
    if (search.value.trim()) params.set('q', search.value.trim());
    // Clients list is the only required call. The settings fetch is optional
    // (only supplies the domain suffix) and is superadmin-only, so we fetch it
    // separately and ignore a 403 — staff still get the full clients page.
    const c = await $fetch<any>(`/api/admin/clients?${params.toString()}`);
    clients.value = c.clients || [];
    total.value = c.total ?? clients.value.length;
    totalPages.value = c.totalPages ?? 1;
    try {
      const s = await $fetch<any>('/api/admin/settings');
      suffix.value = s.clientDomainSuffix || 'digitaltide.io';
    } catch { suffix.value = suffix.value || 'digitaltide.io'; }
  } catch (e: any) {
    error.value = e?.data?.error?.message || e?.data?.message || 'Could not load clients.';
  } finally { pending.value = false; }
}
function reload() { page.value = 1; load(); }
function goPage(p: number) { page.value = p; load(); }

async function create() {
  creating.value = true;
  try {
    const r = await $fetch<any>('/api/admin/clients', { method: 'POST', body: { ...draft } });
    showCreate.value = false;
    Object.assign(draft, { client: '', subdomain: '', country: '', sector: '', businessPhone: '', plan: 'startup', accountsLimit: 10, maxLines: 5, provisionNow: false });
    subdomainEdited.value = false;
    await load();
    if (r?.provisionError) {
      alert(`Client created locally, but carrier provisioning failed: ${r.provisionError}\n\nYou can provision it later at go-live.`);
    }
  } catch (e) { alert(e?.data?.error?.message || e?.data?.message || 'Create failed'); }
  finally { creating.value = false; }
}

async function openClient(domain) {
  try {
    const r = await $fetch(`/api/admin/clients/${encodeURIComponent(domain)}/session`);
    window.open(r.link, '_blank');
  } catch (e) { alert(e?.data?.error?.message || 'Could not open client UI'); }
}

onMounted(load);
</script>

<style scoped>
.ad-head { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 22px; }
.ad-title { font-family: var(--font-display); font-size: 30px; color: var(--ink); letter-spacing: -0.02em; }
.ad-sub { color: var(--ink-mute); font-size: 14px; margin-top: 4px; }
.ad-loading, .ad-empty { color: var(--ink-mute); padding: 40px 0; }
.ad-error { color: #ffb4a8; padding: 24px; background: rgba(192,57,43,0.12); border: 1px solid rgba(192,57,43,0.3); border-radius: var(--radius); }
.ad-error-link { display: block; color: var(--signal-bright); margin-top: 10px; }
.ad-filters { display: flex; gap: 8px; margin-bottom: 18px; flex-wrap: wrap; }
.ad-filter { padding: 7px 14px; border-radius: 999px; font-size: 13px; color: var(--ink-soft); border: 1px solid var(--rule); transition: all 0.14s; }
.ad-filter:hover { color: var(--ink); border-color: var(--ink-soft); }
.ad-filter.on { background: var(--signal); color: var(--ink); border-color: var(--signal); }
.ad-table-wrap { background: var(--paper); border: 1px solid var(--rule); border-radius: var(--radius-lg); overflow: hidden; }
.ad-table { width: 100%; border-collapse: collapse; }
.ad-table th { text-align: left; font-family: var(--font-mono); font-size: 10.5px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink-mute); font-weight: 500; padding: 14px 16px; border-bottom: 1px solid var(--rule); }
.ad-table td { padding: 14px 16px; border-bottom: 1px solid var(--rule-2); color: var(--ink); font-size: 14px; }
.ad-table tbody tr:last-child td { border-bottom: none; }
.ad-table tbody tr:hover { background: var(--paper); }
.ad-name { font-weight: 500; color: var(--ink); }
.ad-dim { color: var(--ink-mute); font-size: 12.5px; }
.ad-unprov { color: var(--warn); font-size: 9px; margin-left: 6px; vertical-align: middle; }
.ad-c { text-align: center; }
.ad-pip { display: inline-block; min-width: 24px; font-size: 13px; color: var(--ink-soft); }
.ad-pip.on { color: var(--live); font-weight: 600; }
.muted-pip { font-size: 10px; color: var(--ink-soft); text-transform: uppercase; letter-spacing: 0.05em; }
.ad-row-actions { display: flex; gap: 8px; justify-content: flex-end; }
.ad-row-actions .btn-ghost { color: var(--ink); border-color: var(--rule); }
.ad-row-actions .btn-ghost:hover { background: var(--paper-3); }
.ad-modal-overlay { position: fixed; inset: 0; z-index: 200; background: rgba(10,10,11,0.32); display: flex; align-items: center; justify-content: center; padding: 24px; }
.ad-modal { width: 100%; max-width: 560px; background: var(--paper); border: 1px solid var(--rule); border-radius: var(--radius-lg); padding: 28px; box-shadow: 0 24px 60px rgba(10,10,11,0.28); animation: adModalPop .2s cubic-bezier(.16,1,.3,1); }
@keyframes adModalPop { from { opacity: 0; transform: translateY(8px) scale(.98); } to { opacity: 1; transform: translateY(0) scale(1); } }
.ad-modal-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; }
.ad-modal-head h3 { font-family: var(--font-display); font-size: 22px; }
.ad-x { color: var(--ink-mute); }
.ad-field { display: flex; flex-direction: column; gap: 6px; margin-bottom: 16px; }
.ad-field label { font-size: 13px; font-weight: 500; }
.ad-input { padding: 11px 14px; border: 1px solid var(--rule); border-radius: var(--radius); font-size: 14.5px; outline: none; }
.ad-input:focus { border-color: var(--signal); box-shadow: 0 0 0 3px var(--signal-soft); }
.ad-slug { display: flex; align-items: center; }
.ad-slug .ad-input { border-radius: var(--radius) 0 0 var(--radius); }
.ad-suffix { padding: 11px 14px; background: var(--paper-2); border: 1px solid var(--rule); border-left: 0; border-radius: 0 var(--radius) var(--radius) 0; color: var(--ink-soft); font-size: 14px; }
.ad-row { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.ad-note { font-size: 12px; color: var(--ink-mute); margin-top: 12px; text-align: center; }
.ad-hint { display: block; font-size: 11.5px; color: var(--ink-mute); margin-top: 6px; }
.ad-plan { display: inline-block; font-size: 12px; font-weight: 500; padding: 3px 10px; border-radius: 999px; background: var(--paper-3); color: var(--ink-soft); }
.ad-plan.growth { background: var(--signal-soft); color: var(--signal); }
.ad-plan.custom { background: rgba(183,121,31,0.12); color: var(--warn); }
.ad-trial { font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--ink-mute); margin-left: 6px; }
.ad-status-pill { font-size: 11px; padding: 3px 9px; border-radius: 999px; }
.ad-status-pill.ok { background: rgba(0,210,138,0.12); color: #0a8a5c; }
.ad-status-pill.pending { background: rgba(183,121,31,0.12); color: var(--warn); }
.ad-head-right { display: flex; align-items: center; gap: 10px; }
.ad-search { padding: 8px 12px; border: 1px solid var(--rule); border-radius: var(--radius); font-size: 13px; min-width: 220px; }
.ad-search:focus { outline: none; border-color: var(--signal); }
.ad-pager { display: flex; align-items: center; justify-content: center; gap: 16px; margin-top: 18px; }
.ad-pager-info { font-size: 13px; color: var(--ink-mute); }
.ad-mode { display: inline-block; margin-left: 6px; font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; padding: 2px 7px; border-radius: 999px; }
.ad-mode.sandbox { color: var(--warn); background: rgba(183,121,31,0.12); }
.ad-mode.live { color: #0a8a5c; background: rgba(0,210,138,0.12); }
.ad-opt { color: var(--ink-mute); font-weight: 400; font-size: 12px; }
.ad-check { display: flex; align-items: flex-start; gap: 9px; margin: 4px 0 4px; font-size: 13px; color: var(--ink-soft); cursor: pointer; line-height: 1.4; }
.ad-check input { margin-top: 2px; flex: none; }

</style>
