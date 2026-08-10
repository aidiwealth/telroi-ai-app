<template>
  <div class="inv-wrap">
    <div v-if="pending" class="card card-pad muted">Loading…</div>

    <template v-else-if="data">
      <div class="inv-actions no-print">
        <NuxtLink to="/wallet" class="btn btn-ghost btn-sm">← Back to wallet</NuxtLink>
        <div class="inv-actions-r">
          <button class="btn btn-ghost btn-sm" @click="print">Download PDF</button>
          <NuxtLink v-if="data.invoice.status === 'open'" to="/wallet" class="btn btn-signal btn-sm">Pay now</NuxtLink>
        </div>
      </div>

      <div class="card inv-doc">
        <div class="inv-head">
          <div>
            <p class="inv-brand">Telroi</p>
            <p class="inv-from">Telroi LLC<br />San Jose, California<br />billing@telroi.ai</p>
          </div>
          <div class="inv-head-r">
            <p class="inv-k">Invoice</p>
            <p class="inv-no mono">{{ data.invoice.number }}</p>
            <span class="inv-badge" :class="badgeClass">{{ badgeText }}</span>
          </div>
        </div>

        <div class="inv-meta">
          <div>
            <p class="inv-k">Billed to</p>
            <p class="inv-v">{{ data.workspace.name }}<br /><span class="muted">{{ data.workspace.email }}</span></p>
          </div>
          <div>
            <p class="inv-k">Period</p>
            <p class="inv-v">{{ longDate(data.invoice.periodStart) }} – {{ longDate(data.invoice.periodEnd) }}</p>
          </div>
          <div>
            <p class="inv-k">Issued</p>
            <p class="inv-v">{{ longDate(data.invoice.issuedAt) }}</p>
          </div>
        </div>

        <table class="inv-lines">
          <thead><tr><th>Description</th><th class="ta-r">Qty</th><th class="ta-r">Amount</th></tr></thead>
          <tbody>
            <tr v-for="(l, i) in data.lines" :key="i">
              <td>{{ l.description }}</td>
              <td class="ta-r muted">{{ l.qty }}</td>
              <td class="ta-r mono">{{ fmt(l.amountMinor) }}</td>
            </tr>
            <tr v-if="!data.lines.length"><td colspan="3" class="muted">No charges in this period.</td></tr>
          </tbody>
        </table>

        <div class="inv-totals-wrap">
          <div class="inv-totals">
            <div class="inv-total-row"><span class="muted">Used this period</span><span class="mono">{{ fmt(data.usedMinor) }}</span></div>
            <div v-if="data.balanceAppliedMinor > 0" class="inv-total-row">
              <span class="muted">Balance applied</span><span class="mono inv-credit">−{{ fmt(data.balanceAppliedMinor) }}</span>
            </div>
            <div class="inv-total-row inv-due"><span>Amount due</span><span class="mono">{{ fmt(data.invoice.amountMinor) }}</span></div>
          </div>
        </div>

        <div v-if="data.bank" class="inv-pay">
          <p class="inv-k">Pay by transfer</p>
          <div class="inv-bank">
            <div><span>Bank</span>{{ data.bank.bankName }}</div>
            <div><span>Account number</span><span class="mono">{{ data.bank.accountNumber }}</span></div>
            <div><span>Account name</span>{{ data.bank.accountName }}</div>
          </div>
          <p class="inv-note">Anything you send clears what you owe — this invoice settles once your balance is back to zero. Card payment is available from your wallet.</p>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
const route = useRoute();
const api = useApi();
useHead({ title: 'Invoice — Telroi' });

const data = ref<any>(null);
const pending = ref(true);

const badgeText = computed(() => {
  const i = data.value?.invoice;
  if (!i) return '';
  if (i.status === 'paid') return `Paid ${shortDate(i.paidAt)}`;
  return new Date(i.dueAt) < new Date() ? `Overdue — was due ${shortDate(i.dueAt)}` : `Due ${shortDate(i.dueAt)}`;
});
const badgeClass = computed(() => {
  const i = data.value?.invoice;
  if (!i) return '';
  if (i.status === 'paid') return 'paid';
  return new Date(i.dueAt) < new Date() ? 'overdue' : 'due';
});

function fmt(minor: number) {
  const sym = data.value?.invoice?.currency === 'USD' ? '$' : '₦';
  return sym + (minor / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function longDate(iso: string) { return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }); }
function shortDate(iso: string) { return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }); }
function print() { window.print(); }

onMounted(async () => {
  try { data.value = await api.get(`/api/invoices/${route.params.id}`); }
  catch { data.value = null; }
  finally { pending.value = false; }
});
</script>

<style scoped>
.inv-wrap { max-width: 780px; margin: 0 auto; }
.inv-actions { display: flex; justify-content: space-between; margin-bottom: 16px; }
.inv-actions-r { display: flex; gap: 8px; }
.inv-doc { padding: 36px 40px; }
.inv-head { display: flex; justify-content: space-between; margin-bottom: 28px; }
.inv-brand { font-size: 19px; font-weight: 500; margin: 0 0 4px; }
.inv-from { font-size: 12.5px; color: var(--ink-soft); margin: 0; line-height: 1.6; }
.inv-head-r { text-align: right; }
.inv-k { font-size: 12px; color: var(--ink-soft); margin: 0 0 4px; }
.inv-no { font-size: 16px; font-weight: 500; margin: 0 0 8px; }
.inv-badge { font-size: 12px; padding: 3px 10px; border-radius: 999px; background: var(--paper-2); color: var(--ink-soft); }
.inv-badge.paid { background: rgba(34,139,84,.12); color: #1c7a49; }
.inv-badge.overdue { background: rgba(180,45,45,.12); color: #a33; }
.inv-meta { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 20px; padding: 18px 0; border-top: 1px solid var(--rule); border-bottom: 1px solid var(--rule); margin-bottom: 24px; }
.inv-v { font-size: 13.5px; margin: 0; line-height: 1.6; }
.inv-lines { width: 100%; border-collapse: collapse; font-size: 13.5px; margin-bottom: 20px; }
.inv-lines th { text-align: left; font-weight: 500; color: var(--ink-soft); font-size: 12px; padding-bottom: 8px; }
.inv-lines td { padding: 11px 0; border-top: 1px solid var(--rule); }
.inv-totals-wrap { display: flex; justify-content: flex-end; }
.inv-totals { width: 270px; }
.inv-total-row { display: flex; justify-content: space-between; font-size: 13.5px; padding: 6px 0; }
.inv-credit { color: #1c7a49; }
.inv-due { border-top: 1px solid var(--ink); margin-top: 6px; padding-top: 11px; font-weight: 500; font-size: 16px; }
.inv-pay { margin-top: 30px; padding-top: 20px; border-top: 1px solid var(--rule); }
.inv-bank { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 14px; font-size: 13px; }
.inv-bank span { display: block; font-size: 12px; color: var(--ink-soft); margin-bottom: 2px; }
.inv-note { font-size: 12.5px; color: var(--ink-soft); margin: 16px 0 0; line-height: 1.6; }
.ta-r { text-align: right; }

/* The document alone on paper: the browser makes the PDF, so the page just has
   to get out of its own way. */
@media print {
  .no-print { display: none; }
  .inv-doc { border: 0; padding: 0; box-shadow: none; }
  .inv-wrap { max-width: none; }
}
</style>
