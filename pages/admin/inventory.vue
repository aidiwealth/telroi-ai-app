<template>
  <div>
    <div class="ad-head">
      <div>
        <h1 class="ad-title">Number inventory</h1>
        <p class="ad-sub">Numbers customers can buy. Search Twilio/Telnyx to buy new ones; add Nigerian (Digidite) numbers manually.</p>
      </div>
      <div class="ad-head-actions">
        <button class="btn btn-signal btn-sm" @click="openModal">+ Add numbers</button>
      </div>
    </div>

    <div v-if="pending" class="ad-loading">Loading inventory…</div>
    <div v-else-if="rows.length" class="ad-table-wrap">
      <table class="ad-table">
        <thead><tr><th>Number</th><th>Region</th><th>Carrier</th><th>Provisioned</th><th>Status</th><th></th></tr></thead>
        <tbody>
          <tr v-for="r in rows" :key="r.id">
            <td class="mono ad-name">{{ r.telnum }}</td>
            <td>{{ regionLabel(r.region) }}</td>
            <td class="ad-dim">{{ provLabel(r.provider) }}</td>
            <td>
              <span class="ad-prov" :class="r.provisionStatus">{{ r.provisionStatus }}</span>
            </td>
            <td><span class="ad-pip" :class="{ on: r.status === 'available' }">{{ r.status }}</span></td>
            <td class="ad-row-actions">
              <button v-if="r.provisionStatus !== 'provisioned'" class="btn btn-ghost btn-sm" :disabled="provisioning === r.id" @click="provision(r.id)">
                {{ provisioning === r.id ? '…' : 'Provision' }}
              </button>
              <button v-if="!r.provisionRef && r.status === 'available'" class="btn btn-ghost btn-sm" @click="editNumber(r)">Edit</button>
              <button v-if="r.status === 'available'" class="btn btn-ghost btn-sm" @click="remove(r.id)">Remove</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <EmptyState v-else icon="numbers" title="No numbers in inventory yet" description="Add numbers so customers can purchase them during onboarding or from their dashboard." />

    <!-- Unified Add-numbers modal with sub-tabs -->
    <div v-if="showModal" class="ad-modal-overlay" @click.self="showModal = false">
      <div class="ad-modal ad-modal-wide">
        <div class="ad-modal-head"><h3>Add numbers</h3><button class="ad-x" @click="showModal = false">✕</button></div>

        <div class="inv-tabs">
          <button class="inv-tab" :class="{ on: tab === 'other' }" @click="tab = 'other'">Other numbers</button>
          <button class="inv-tab" :class="{ on: tab === 'ng' }" @click="tab = 'ng'">Nigerian numbers</button>
        </div>

        <!-- OTHER NUMBERS: live Twilio/Telnyx search & buy -->
        <div v-show="tab === 'other'" class="inv-pane">
          <p class="inv-pane-lede">Search Twilio or Telnyx for available numbers and buy one. Buying charges your carrier account and adds the number to inventory for clients to purchase. Customers never see the carrier.</p>
          <div class="srch-row">
            <select v-model="srch.provider" class="ad-input"><option value="twilio">Twilio</option><option value="telnyx">Telnyx</option></select>
            <select v-model="srch.country" class="ad-input"><option value="US">United States</option><option value="CA">Canada</option><option value="GB">United Kingdom</option></select>
            <input v-model="srch.areaCode" class="ad-input" placeholder="Area code (optional)" />
            <button class="btn btn-signal btn-sm" :disabled="searching" @click="runSearch">{{ searching ? 'Searching…' : 'Search' }}</button>
          </div>
          <p v-if="searchErr" class="ad-hint" style="color:var(--danger)">{{ searchErr }}</p>
          <div v-if="found.length" class="srch-list">
            <div v-for="n in found" :key="n.telnum" class="srch-item">
              <span class="mono">{{ n.telnum }}</span>
              <span class="ad-dim">{{ n.locality || regionLabel(n.region) }}</span>
              <button class="btn btn-ghost btn-sm" :disabled="buying === n.telnum" @click="buy(n)">{{ buying === n.telnum ? 'Buying…' : 'Buy' }}</button>
            </div>
          </div>
          <p v-else-if="searched && !searching" class="ad-hint">No purchasable numbers found for those filters.</p>
        </div>

        <!-- NIGERIAN NUMBERS: manual add (Telroi Voice) -->
        <div v-show="tab === 'ng'" class="inv-pane">
          <p class="inv-pane-lede">Add Nigerian numbers you manage on Telroi Voice (your own Asterisk PBX). Paste one or more, then they’re available to assign and for clients to purchase.</p>
          <div class="ad-field">
            <label>Carrier</label>
            <select v-model="draft.provider" class="ad-input">
              <option value="telroi">Digidite (Telroi PBX)</option>
              <option value="asterisk">Core Asterisk (global SIP trunk)</option>
              <option value="ruach">Ruach (NG SIP trunk)</option>
              <option value="sotel">Sotel (NG SIP trunk)</option>
              <option value="kasooko">Kasooko (NG SIP trunk)</option>
            </select>
          </div>
          <div class="ad-field">
            <label>Numbers (one per line, or comma-separated)</label>
            <textarea v-model="draft.numbers" class="ad-input ad-textarea mono" rows="5" placeholder="+2348012345678&#10;+2348098765432"></textarea>
          </div>
          <button class="btn btn-signal btn-block" :disabled="adding || !draft.numbers.trim()" @click="add">
            {{ adding ? 'Adding…' : 'Add to inventory' }}
          </button>
        </div>
      </div>
    </div>

    <!-- Correct a mistyped number (hand-added, unsold rows only) -->
    <div v-if="editRow" class="ad-modal-overlay" @click.self="editRow = null">
      <div class="ad-modal" style="max-width:420px">
        <div class="ad-modal-head"><h3>Edit number</h3><button class="ad-x" @click="editRow = null">✕</button></div>
        <p class="ad-none" style="margin:8px 0 14px">
          Fix a number that was typed incorrectly. The region is re-detected from the new digits and must still suit the carrier.
        </p>
        <div class="ad-field">
          <label>Number</label>
          <input v-model="editTelnum" class="ad-input mono" placeholder="+2348012345678" @keyup.enter="saveEdit" />
        </div>
        <p class="ad-hint" style="margin:6px 0 16px">Currently <span class="mono">{{ editRow.telnum }}</span> · {{ provLabel(editRow.provider) }}</p>
        <div style="display:flex;gap:10px;justify-content:flex-end">
          <button class="btn btn-ghost" @click="editRow = null">Cancel</button>
          <button class="btn btn-signal" :disabled="savingEdit || !editTelnum.trim() || editTelnum.trim() === editRow.telnum" @click="saveEdit">
            {{ savingEdit ? 'Saving…' : 'Save' }}
          </button>
        </div>
      </div>
    </div>

    <!-- Styled confirm (replaces browser confirm) for removing a number -->
    <div v-if="confirmRemove" class="ad-modal-overlay" @click.self="confirmRemove = null">
      <div class="ad-modal" style="max-width:380px">
        <div class="ad-modal-head"><h3>Remove number?</h3><button class="ad-x" @click="confirmRemove = null">✕</button></div>
        <p class="ad-none" style="margin:8px 0 18px">This removes the number from inventory. This can't be undone.</p>
        <div style="display:flex;gap:10px;justify-content:flex-end">
          <button class="btn btn-ghost btn-sm" @click="confirmRemove = null">Cancel</button>
          <button class="btn btn-danger btn-sm" @click="doRemove">Remove</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
const toast = useToast();
const confirmRemove = ref<string | null>(null); // inventory id pending removal
definePageMeta({ layout: 'admin' });
useHead({ title: 'Number inventory — Telroi Operator' });

const pending = ref(true);
const rows = ref<any[]>([]);
const showModal = ref(false);
const tab = ref<'other' | 'ng'>('other');
const adding = ref(false);
const provisioning = ref<string | null>(null);
const draft = ref<{ numbers: string; provider: string; regionOverride?: string }>({ numbers: '', provider: 'telroi', regionOverride: 'NG' });

function openModal() {
  showModal.value = true; tab.value = 'other';
  found.value = []; searched.value = false; searchErr.value = '';
  draft.value = { numbers: '', provider: draft.value?.provider || 'telroi', regionOverride: 'NG' };
}

// Carrier search & buy
const searching = ref(false);
const searched = ref(false);
const searchErr = ref('');
const found = ref<any[]>([]);
const buying = ref<string | null>(null);
const srch = ref<{ provider: string; country: string; areaCode?: string }>({ provider: 'twilio', country: 'US', areaCode: '' });

async function runSearch() {
  searching.value = true; searchErr.value = ''; found.value = [];
  try {
    const r = await $fetch<any>('/api/admin/carrier/search', { method: 'POST', body: { provider: srch.value.provider, country: srch.value.country, areaCode: srch.value.areaCode || undefined } });
    found.value = r.numbers || [];
    searched.value = true;
  } catch (e: any) { searchErr.value = e?.data?.error?.message || 'Search failed'; }
  finally { searching.value = false; }
}
async function buy(n: any) {
  buying.value = n.telnum;
  try {
    await $fetch('/api/admin/carrier/buy', { method: 'POST', body: { provider: srch.value.provider, telnum: n.telnum, region: srch.value.country } });
    found.value = found.value.filter((x) => x.telnum !== n.telnum);
    await load();
  } catch (e: any) { searchErr.value = e?.data?.error?.message || 'Purchase failed'; }
  finally { buying.value = null; }
}

const PROV: Record<string, string[]> = { NG: ['Telroi', 'Asterisk'], US: ['Twilio', 'Telnyx', 'Asterisk'], CA: ['Twilio', 'Telnyx', 'Asterisk'], GB: ['Twilio', 'Telnyx', 'Asterisk'] };
function providersFor(r: string) { return PROV[r] || ['Telroi']; }
function provLabel(p: string) { return ({ telroi: 'Telroi Voice', twilio: 'Twilio', telnyx: 'Telnyx', asterisk: 'Telroi Voice', ruach: 'Ruach', sotel: 'Sotel', kasooko: 'Kasooko' } as any)[p] || p; }
function regionLabel(r: string) { return ({ NG: 'Nigeria', US: 'United States', CA: 'Canada', GB: 'United Kingdom' } as any)[r] || r; }

async function load() {
  pending.value = true;
  try { rows.value = await $fetch('/api/admin/inventory'); }
  catch (e: any) { /* */ }
  finally { pending.value = false; }
}
async function add() {
  adding.value = true;
  try {
    // NG tab always adds Nigerian/Telroi numbers.
    const r = await $fetch<any>('/api/admin/inventory', { method: 'POST', body: { numbers: draft.value.numbers, provider: draft.value.provider || 'telroi', regionOverride: 'NG' } });
    showModal.value = false;
    draft.value = { numbers: '', provider: draft.value?.provider || 'telroi', regionOverride: 'NG' };
    await load();
    toast.ok(`Added ${r.added}${r.skipped ? `, skipped ${r.skipped} duplicate(s)` : ''}.`);
  } catch (e: any) { toast.err(e?.data?.error?.message || 'Add failed'); }
  finally { adding.value = false; }
}
// Correct a mistyped number. Only offered for hand-added, unsold rows — the
// server enforces the same rules, since an API-bought number's digits point at a
// real carrier purchase and a sold one is somebody's live inbound line.
const editRow = ref<any | null>(null);
const editTelnum = ref('');
const savingEdit = ref(false);
function editNumber(r: any) { editRow.value = r; editTelnum.value = r.telnum; }
async function saveEdit() {
  const r = editRow.value; if (!r) return;
  const next = editTelnum.value.trim();
  if (!next || next === r.telnum) return;
  savingEdit.value = true;
  try {
    await $fetch(`/api/admin/inventory/${r.id}`, { method: 'PATCH', body: { telnum: next } });
    editRow.value = null;
    await load();
    toast.ok('Number updated.');
  } catch (e: any) {
    toast.err(e?.data?.message || e?.message || 'Could not update the number.');
  } finally {
    savingEdit.value = false;
  }
}

async function provision(id: string) {
  provisioning.value = id;
  try {
    await $fetch(`/api/admin/inventory/${id}/provision`, { method: 'POST' });
    await load();
    toast.ok('Number provisioned.');
  } catch (e: any) { toast.err(e?.data?.error?.message || 'Provisioning failed'); }
  finally { provisioning.value = null; }
}
async function remove(id: string) {
  confirmRemove.value = id; // open styled confirm modal
}
async function doRemove() {
  const id = confirmRemove.value; if (!id) return;
  confirmRemove.value = null;
  try { await $fetch(`/api/admin/inventory/${id}`, { method: 'DELETE' }); await load(); toast.ok('Number removed.'); }
  catch (e: any) { toast.err(e?.data?.error?.message || 'Could not remove'); }
}

onMounted(load);
</script>

<style scoped>
.ad-head { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 22px; }
.ad-title { font-family: var(--font-display); font-size: 30px; color: var(--ink); letter-spacing: -0.02em; }
.ad-sub { color: var(--ink-mute); font-size: 14px; margin-top: 4px; }
.ad-loading, .ad-empty { color: var(--ink-mute); padding: 40px 0; }
.ad-table-wrap { background: var(--paper); border: 1px solid var(--rule); border-radius: var(--radius-lg); overflow: hidden; }
.ad-table { width: 100%; border-collapse: collapse; }
.ad-table th { text-align: left; font-family: var(--font-mono); font-size: 10.5px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink-mute); font-weight: 500; padding: 14px 16px; border-bottom: 1px solid var(--rule); }
.ad-table td { padding: 14px 16px; border-bottom: 1px solid var(--rule-2); color: var(--ink); font-size: 14px; }
.ad-table tbody tr:last-child td { border-bottom: none; }
.ad-name { font-weight: 500; color: var(--ink); }
.ad-dim { color: var(--ink-mute); font-size: 12.5px; }
.ad-pip { font-size: 12px; text-transform: capitalize; color: var(--ink-mute); }
.ad-pip.on { color: var(--live); }
.ad-row-actions { text-align: right; }
.ad-row-actions .btn-ghost { color: var(--ink); border-color: var(--rule); }
.ad-row-actions .btn-ghost:hover { background: var(--paper-3); }
.ad-modal-overlay { position: fixed; inset: 0; z-index: 200; background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; padding: 24px; }
.ad-modal { width: 100%; max-width: 460px; background: var(--paper); border-radius: var(--radius-lg); padding: 28px; }
.ad-modal-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; }
.ad-modal-head h3 { font-family: var(--font-display); font-size: 22px; }
.ad-x { color: var(--ink-mute); }
.ad-field { display: flex; flex-direction: column; gap: 6px; margin-bottom: 16px; }
.ad-field label { font-size: 13px; font-weight: 500; }
.ad-input { padding: 11px 14px; border: 1px solid var(--rule); border-radius: var(--radius); font-size: 14.5px; outline: none; }
.ad-input:focus { border-color: var(--signal); box-shadow: 0 0 0 3px var(--signal-soft); }
.ad-textarea { resize: vertical; line-height: 1.5; }
.ad-hint { font-size: 12px; color: var(--ink-mute); }
.ad-prov { font-size: 11px; text-transform: capitalize; color: var(--ink-mute); }
.ad-prov.provisioned { color: var(--live); }
.ad-prov.failed { color: #e0664e; }
.ad-prov.unprovisioned { color: var(--ink-mute); }
.ad-head-actions { display: flex; gap: 10px; }
.ad-modal-wide { max-width: 640px; }
.inv-tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--rule); margin-bottom: 16px; }
.inv-tab { padding: 9px 14px; font-size: 13px; color: var(--ink-soft); border-bottom: 2px solid transparent; margin-bottom: -1px; }
.inv-tab:hover { color: var(--ink); }
.inv-tab.on { color: var(--signal); border-bottom-color: var(--signal); font-weight: 500; }
.inv-pane-lede { font-size: 12.5px; color: var(--ink-soft); line-height: 1.5; margin-bottom: 14px; }
.srch-row { display: grid; grid-template-columns: 1fr 1fr 1fr auto; gap: 8px; margin-bottom: 14px; }
.srch-list { display: flex; flex-direction: column; gap: 6px; margin-bottom: 12px; max-height: 320px; overflow-y: auto; }
.srch-item { display: flex; align-items: center; gap: 12px; padding: 8px 10px; border: 1px solid var(--rule); border-radius: var(--radius); }
.srch-item .mono { flex: 1; }
.srch-item .ad-dim { font-size: 12px; color: var(--ink-mute); }
</style>
