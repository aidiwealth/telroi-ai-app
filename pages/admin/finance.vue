<template>
  <div>
    <h1 class="ad-title">Financial logs</h1>
    <p class="ad-sub">Every float paid in and every debit across the platform, categorised by feature. Amounts are shown in USD for accounting; toggle to see a client's native currency and the exchange rate applied.</p>

    <!-- Currency view toggle + live rate -->
    <div class="fin-cur">
      <div class="fin-seg">
        <button :class="{ on: view === 'usd' }" @click="view = 'usd'">USD</button>
        <button :class="{ on: view === 'native' }" @click="view = 'native'">Native currency</button>
      </div>
      <span class="fin-rate">Current rate: $1 = ₦{{ currentRate.toLocaleString() }}</span>
    </div>

    <!-- Summary: totals (always USD baseline) -->
    <div class="fin-summary">
      <div class="fin-card">
        <span class="fin-card-label">Float in (USD)</span>
        <span class="fin-card-val credit">+{{ usd(totals.creditUsdMinor) }}</span>
      </div>
      <div class="fin-card">
        <span class="fin-card-label">Debits (USD)</span>
        <span class="fin-card-val debit">−{{ usd(totals.debitUsdMinor) }}</span>
      </div>
      <div class="fin-card">
        <span class="fin-card-label">Net (USD)</span>
        <span class="fin-card-val mono">{{ usd(totals.creditUsdMinor - totals.debitUsdMinor) }}</span>
      </div>
    </div>

    <!-- One tidy filter bar: direction toggle + a feature dropdown -->
    <div class="fin-bar">
      <div class="fin-seg">
        <button :class="{ on: kind === 'all' }" @click="setKind('all')">All</button>
        <button :class="{ on: kind === 'credit' }" @click="setKind('credit')">Float in</button>
        <button :class="{ on: kind === 'debit' }" @click="setKind('debit')">Debits</button>
      </div>
      <select v-model="category" class="fin-select" @change="load">
        <option value="all">All features</option>
        <option v-for="c in categories" :key="c" :value="c">{{ catLabel(c) }}</option>
      </select>
      <select v-model="sandboxFilter" class="fin-select" @change="load">
        <option value="all">Live + sandbox</option>
        <option value="exclude">Live only</option>
        <option value="only">Sandbox only</option>
      </select>
      <ExportButton :url="exportUrl" label="Export (30d)" class="fin-export" />
    </div>
    <p class="fin-export-note">Exports cover the last 30 days, streamed as CSV.</p>

    <div v-if="pending" class="ad-loading">Loading…</div>
    <EmptyState v-else-if="!entries.length" icon="generic" title="No financial activity yet" description="Top-ups and feature charges will appear here as they happen." />
    <div v-else class="set-card ad-table-wrap">
      <table class="ad-data-table">
        <thead>
          <tr><th>When</th><th>Workspace</th><th>Category</th><th>Type</th><th class="ad-r">Amount</th><th class="ad-r">Rate</th><th class="ad-r">Balance after</th></tr>
        </thead>
        <tbody>
          <tr v-for="e in entries" :key="e.id">
            <td class="mono ad-dim">{{ fmt(e.createdAt) }}</td>
            <td class="">{{ e.workspace }}<span v-if="e.internal" class="fin-internal">internal</span><span v-if="e.sandbox" class="fin-sandbox">sandbox</span></td>
            <td><span class="fin-cat" :class="e.category">{{ e.label }}</span></td>
            <td><span class="fin-kind" :class="e.kind">{{ e.kind === 'credit' ? 'Float in' : 'Debit' }}</span></td>
            <td class="ad-r mono" :class="e.kind">{{ e.kind === 'credit' ? '+' : '−' }}{{ amount(e) }}</td>
            <td class="ad-r mono ad-dim">{{ e.nativeCurrency === 'NGN' ? ('₦' + e.fxRate.toLocaleString()) : '—' }}</td>
            <td class="ad-r mono ad-dim">{{ balanceAfter(e) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
definePageMeta({ layout: 'admin' });
useHead({ title: 'Financial logs — Telroi Operator' });

const entries = ref<any[]>([]);
const totals = ref<any>({ creditUsdMinor: 0, debitUsdMinor: 0, byCategoryUsdMinor: {} });
const currentRate = ref(1600);
const view = ref<'usd' | 'native'>('usd');
const pending = ref(true);
const kind = ref<'all' | 'credit' | 'debit'>('all');
const category = ref<string>('all');
const sandboxFilter = ref<'all' | 'exclude' | 'only'>('all');
const exportUrl = computed(() => {
  const p = new URLSearchParams();
  if (kind.value !== 'all') p.set('kind', kind.value);
  if (category.value !== 'all') p.set('category', category.value);
  const qs = p.toString();
  return '/api/admin/finance/export' + (qs ? `?${qs}` : '');
});
const categories = ['float', 'voice', 'numbers', 'plan', 'other'];

function usd(minor: number) { return '$' + ((minor || 0) / 100).toFixed(2); }
function sym(cur: string) { return cur === 'NGN' ? '₦' : '$'; }
// Per-entry amount in the selected view: USD-normalized, or the native amount.
function amount(e: any) {
  if (view.value === 'usd') return usd(e.usdMinor);
  return sym(e.nativeCurrency) + ((e.amountMinor || 0) / 100).toFixed(2);
}
function balanceAfter(e: any) {
  if (view.value === 'usd') {
    const u = e.nativeCurrency === 'NGN' ? Math.round(e.balanceAfterMinor / (e.fxRate || currentRate.value)) : e.balanceAfterMinor;
    return usd(u);
  }
  return sym(e.nativeCurrency) + ((e.balanceAfterMinor || 0) / 100).toFixed(2);
}
function catLabel(c: string) { return ({ float: 'Float', voice: 'Voice', numbers: 'Numbers', plan: 'Plan', other: 'Other' } as any)[c] || c; }
function fmt(d: string) { return new Date(d).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }

async function load() {
  pending.value = true;
  try {
    const q: any = {};
    if (kind.value !== 'all') q.kind = kind.value;
    if (category.value !== 'all') q.category = category.value;
    if (sandboxFilter.value !== 'all') q.sandbox = sandboxFilter.value;
    const r = await $fetch<any>('/api/admin/finance', { query: q });
    entries.value = r.entries || [];
    totals.value = r.totals || { creditUsdMinor: 0, debitUsdMinor: 0, byCategoryUsdMinor: {} };
    if (r.currentRate) currentRate.value = r.currentRate;
  } catch (e: any) {
    if (e?.statusCode === 401) await navigateTo('/admin/login');
  } finally { pending.value = false; }
}
function setKind(k: any) { kind.value = k; load(); }
onMounted(load);
</script>

<style scoped>
.fin-cur { display: flex; align-items: center; gap: 14px; margin-bottom: 14px; }
.fin-rate { font-size: 12.5px; color: var(--ink-soft); }
.fin-summary { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 18px; }
.fin-card { background: var(--paper); border: 1px solid var(--rule); border-radius: var(--radius); padding: 14px 16px; }
.fin-card-label { display: block; font-size: 12px; color: var(--ink-mute); margin-bottom: 6px; }
.fin-card-val { font-size: 20px; font-weight: 500; }
.fin-card-val.credit { color: #0a8a5c; }
.fin-card-val.debit { color: var(--danger); }
.fin-bar { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 16px; flex-wrap: wrap; }
.fin-seg { display: inline-flex; border: 1px solid var(--rule); border-radius: 999px; overflow: hidden; background: var(--paper); }
.fin-seg button { padding: 7px 16px; font-size: 13px; color: var(--ink-soft); border-right: 1px solid var(--rule); transition: background 0.14s, color 0.14s; }
.fin-seg button:last-child { border-right: none; }
.fin-seg button.on { background: var(--signal); color: #fff; }
.fin-select { padding: 8px 14px; border: 1px solid var(--rule); border-radius: var(--radius); font-size: 13px; background: var(--paper); color: var(--ink); cursor: pointer; }
.fin-select:focus { outline: none; border-color: var(--signal); }

.fin-cat { font-size: 12px; padding: 3px 10px; border-radius: 999px; background: var(--paper-3); color: var(--ink-soft); }
.fin-cat.float { background: var(--signal-soft); color: var(--signal); }
.fin-cat.voice { background: rgba(0,210,138,0.12); color: #0a8a5c; }
.fin-cat.numbers { background: rgba(77,131,179,0.14); color: var(--signal-bright); }
.fin-cat.plan { background: rgba(183,121,31,0.12); color: var(--warn); }
.fin-kind { font-size: 11.5px; }
.fin-kind.credit { color: #0a8a5c; }
.fin-kind.debit { color: var(--danger); }
.ad-r.credit { color: #0a8a5c; }
.ad-r.debit { color: var(--danger); }
.fin-internal { font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--ink-mute); margin-left: 6px; border: 1px solid var(--rule); padding: 1px 5px; border-radius: 4px; }
.fin-sandbox { display: inline-block; margin-left: 6px; padding: 1px 7px; font-size: 10px; font-weight: 600; border-radius: 999px; background: var(--warn, #b7791f); color: #fff; text-transform: uppercase; letter-spacing: 0.03em; }
.fin-export { margin-left: auto; }
.fin-export-note { font-size: 11.5px; color: var(--ink-mute); margin: -8px 0 16px; }
</style>
