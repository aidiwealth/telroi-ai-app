<template>
  <div>
    <div class="page-head wal-pagehead">
      <div>
        <h1 class="page-title">Wallet</h1>
        <p class="page-sub">Top up and pay as you use — voice, numbers and features bill from here.</p>
      </div>
    </div>

    <!-- Stored card + funding -->
    <div class="wal-top">
      <!-- The card -->
      <div class="wal-card">
        <div class="wal-card-sheen" />
        <div class="wal-card-row">
          <div class="wal-card-brand">Telroi</div>
          <div class="wal-card-chip">
            <svg viewBox="0 0 40 32" width="36" height="28"><rect x="1" y="1" width="38" height="30" rx="5" fill="none" stroke="rgba(255,255,255,0.5)"/><path d="M1 11h12M1 21h12M27 11h12M27 21h12M13 1v30M27 1v30" stroke="rgba(255,255,255,0.4)" fill="none"/></svg>
          </div>
        </div>
        <div class="wal-card-label">Available balance</div>
        <div class="wal-card-balance money" v-if="!pending">
          <template v-if="bal.neg">−</template>{{ bal.sym }}{{ bal.whole }}<span class="cents">{{ bal.cents }}</span>
        </div>
        <div class="skeleton wal-card-skel" v-else />
        <div class="wal-card-foot">
          <div>
            <div class="wal-card-foot-label">Workspace</div>
            <div class="wal-card-foot-val">{{ auth.tenant?.name || '—' }}</div>
          </div>
          <div class="wal-card-foot-right">
            <span class="wal-card-cur">{{ wallet.currency }}</span>
            <span class="wal-card-plan">{{ wallet.plan }}</span>
          </div>
        </div>
      </div>

      <!-- Funding panel -->
      <div class="wal-fund">
        <div class="wal-fund-tabs" v-if="wallet.currency === 'NGN'">
          <button class="wal-fund-tab" :class="{ on: fundTab === 'transfer' }" @click="fundTab = 'transfer'">Bank transfer</button>
          <button class="wal-fund-tab" :class="{ on: fundTab === 'card' }" @click="fundTab = 'card'">Card</button>
        </div>

        <!-- Bank transfer (Monnify virtual account) -->
        <div v-if="wallet.currency === 'NGN' && fundTab === 'transfer'" class="wal-fund-body">
          <template v-if="account">
            <p class="wal-fund-lede">Transfer any amount to this account — your wallet is credited automatically.</p>
            <div class="wal-acct">
              <div class="wal-acct-row"><span class="wal-acct-k">Bank</span><span class="wal-acct-v">{{ account.bankName }}</span></div>
              <div class="wal-acct-row"><span class="wal-acct-k">Account number</span><span class="wal-acct-v mono wal-acct-num">{{ account.accountNumber }} <button class="wal-copy" @click="copy(account.accountNumber)">{{ copied ? '✓' : 'Copy' }}</button></span></div>
              <div class="wal-acct-row"><span class="wal-acct-k">Account name</span><span class="wal-acct-v">{{ account.accountName }}</span></div>
            </div>
          </template>
          <template v-else>
            <p class="wal-fund-lede">Get a dedicated Moniepoint account number for your workspace. Bank rules require a BVN or NIN.</p>
            <div class="field"><label>BVN or NIN (11 digits)</label><input v-model="kyc" class="input mono" maxlength="11" placeholder="12345678901" /></div>
            <button class="btn btn-signal btn-block" :disabled="creatingAcct || kyc.length !== 11" @click="createAccount">
              {{ creatingAcct ? 'Creating account…' : 'Generate account number' }}
            </button>
          </template>
        </div>

        <!-- Card (Paystack NGN / Stripe USD) -->
        <div v-if="wallet.currency !== 'NGN' || fundTab === 'card'" class="wal-fund-body">
          <div class="wal-quick">
            <button v-for="a in quickAmounts" :key="a" class="wal-quick-btn" :class="{ on: amountMajor === a }" @click="amountMajor = a">
              {{ wallet.currency === 'NGN' ? '₦' : '$' }}{{ a.toLocaleString() }}
            </button>
          </div>
          <div class="field"><label>Amount ({{ wallet.currency }})</label><input v-model.number="amountMajor" type="number" min="1" class="input mono" /></div>
          <button class="btn btn-signal btn-block" :disabled="topping || !amountMajor" @click="topup">{{ topping ? 'Redirecting…' : `Continue with ${provider}` }}</button>
          <p class="wal-pay-note muted">{{ wallet.currency === 'NGN' ? 'Secured by Paystack' : 'Secured by Stripe' }}.</p>
        </div>
      </div>
    </div>

    <!-- Money movement -->
    <div class="wal-movement-head">
      <h2 class="wal-section-title">Money movement</h2>
      <div class="wal-month-nav">
        <button class="wal-month-btn" @click="changeMonth(-1)">‹</button>
        <span class="wal-month">{{ monthLabel }}</span>
        <button class="wal-month-btn" @click="changeMonth(1)" :disabled="isCurrentMonth">›</button>
      </div>
    </div>

    <div class="wal-movement">
      <div class="card wal-move-card">
        <div class="card-pad">
          <div class="wal-move-label">Money in</div>
          <div class="wal-move-amount money pos">{{ mIn.sym }}{{ mIn.whole }}<span class="cents">{{ mIn.cents }}</span></div>
        </div>
        <div class="wal-move-foot">
          <span class="muted">{{ summary.moneyInMinor ? 'Top-ups & credits' : 'No incoming funds' }}</span>
        </div>
        <div class="wal-move-foot wal-move-avg">
          <span class="muted">Last 3 months average</span>
          <span class="money muted">{{ avgIn.sym }}{{ avgIn.whole }}<span class="cents">{{ avgIn.cents }}</span></span>
        </div>
      </div>

      <div class="card wal-move-card">
        <div class="card-pad">
          <div class="wal-move-label">Money debited</div>
          <div class="wal-move-amount money">{{ mOut.sym }}{{ mOut.whole }}<span class="cents">{{ mOut.cents }}</span></div>
        </div>
        <div class="wal-move-foot">
          <span class="muted">{{ summary.moneyOutMinor ? 'Usage & fees' : 'No outgoing charges' }}</span>
        </div>
        <div class="wal-move-foot wal-move-avg">
          <span class="muted">Last 3 months average</span>
          <span class="money muted">{{ avgOut.sym }}{{ avgOut.whole }}<span class="cents">{{ avgOut.cents }}</span></span>
        </div>
      </div>
    </div>

    <!-- Transactions -->
    <div class="wal-tx-head">
      <h2 class="wal-section-title">Transactions</h2>
      <button v-if="ledger.length" class="btn btn-ghost btn-sm" @click="exportLast30">Export last 30 days</button>
    </div>
    <div class="card wal-ledger">
      <div v-if="pending" class="loading-pad"><div v-for="i in 5" :key="i" class="skeleton skel-row" /></div>
      <table v-else-if="ledger.length" class="table">
        <thead><tr><th>Date</th><th>Description</th><th class="amount">Amount</th><th class="amount">Balance</th><th></th></tr></thead>
        <tbody>
          <tr v-for="l in ledger" :key="l.id" class="clickable" @click="selected = l">
            <td class="muted wal-date">{{ fmtDate(l.createdAt) }}</td>
            <td>
              <div class="wal-desc">
                <span class="wal-desc-icon" :class="l.kind">{{ l.kind === 'credit' ? '↓' : '↑' }}</span>
                {{ describe(l.reason) }}
                <span v-if="l.sandbox" class="sbx-badge">Sandbox</span>
              </div>
            </td>
            <td class="amount">
              <span class="money" :class="l.kind === 'credit' ? 'pos' : 'neg'">
                {{ l.kind === 'credit' ? '+' : '−' }}{{ part(l.amountMinor).sym }}{{ part(l.amountMinor).whole }}<span class="cents">{{ part(l.amountMinor).cents }}</span>
              </span>
            </td>
            <td class="amount"><span class="money muted">{{ part(l.balanceAfterMinor).sym }}{{ part(l.balanceAfterMinor).whole }}<span class="cents">{{ part(l.balanceAfterMinor).cents }}</span></span></td>
            <td class="wal-chev">›</td>
          </tr>
        </tbody>
      </table>
      <EmptyState v-else icon="generic" title="No transactions yet" description="Top up to get started — your activity will show here." />
    </div>

    <!-- Transaction detail drawer with timeline -->
    <Transition name="drawer">
      <div v-if="selected" class="drawer-overlay" @click.self="selected = null">
        <aside class="drawer">
          <div class="drawer-head">
            <span class="drawer-kicker">{{ selected.kind === 'credit' ? 'Credit' : 'Debit' }}</span>
            <button class="modal-x" @click="selected = null">✕</button>
          </div>
          <div class="drawer-amount money" :class="selected.kind === 'credit' ? 'pos' : ''">
            {{ selected.kind === 'credit' ? '+' : '−' }}{{ part(selected.amountMinor).sym }}{{ part(selected.amountMinor).whole }}<span class="cents">{{ part(selected.amountMinor).cents }}</span>
          </div>
          <div class="drawer-sub">{{ describe(selected.reason) }} · {{ fmtDateTime(selected.createdAt) }}</div>

          <div class="timeline drawer-timeline">
            <div class="timeline-step done"><div class="timeline-dot">✓</div><div><div class="timeline-label">Created</div><div class="timeline-time">{{ fmtDateTime(selected.createdAt) }}</div></div></div>
            <div class="timeline-step done"><div class="timeline-dot">✓</div><div><div class="timeline-label">{{ selected.kind === 'credit' ? 'Payment received' : 'Submitted' }}</div><div class="timeline-time">{{ fmtDateTime(selected.createdAt) }}</div></div></div>
            <div class="timeline-step done"><div class="timeline-dot">✓</div><div><div class="timeline-label">Settled</div><div class="timeline-time">{{ fmtDateTime(selected.createdAt) }}</div></div></div>
            <div class="timeline-step done"><div class="timeline-dot">✓</div><div><div class="timeline-label">Completed</div><div class="timeline-time">{{ fmtDateTime(selected.createdAt) }}</div></div></div>
          </div>

          <dl class="drawer-dl">
            <div><dt>Reference</dt><dd class="mono">{{ selected.reference || '—' }}</dd></div>
            <div><dt>Balance after</dt><dd class="money">{{ part(selected.balanceAfterMinor).sym }}{{ part(selected.balanceAfterMinor).whole }}<span class="cents">{{ part(selected.balanceAfterMinor).cents }}</span></dd></div>
            <div><dt>Type</dt><dd style="text-transform:capitalize">{{ selected.reason.replace('_', ' ') }}</dd></div>
          </dl>
        </aside>
      </div>
    </Transition>

  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useAuthStore } from '~/stores/auth';

useHead({ title: 'Wallet — Telroi' });
const api = useApi();
const toast = useToast();
const route = useRoute();
const money = useMoney();
const auth = useAuthStore();

const pending = ref(true);
const wallet = ref<any>({ currency: 'USD', balanceMinor: 0, plan: 'startup' });
const ledger = ref<any[]>([]);

function exportLast30() {
  const cutoff = Date.now() - 30 * 24 * 3600 * 1000;
  const rows = ledger.value.filter((l: any) => new Date(l.createdAt).getTime() >= cutoff);
  const esc = (v: any) => { const str = String(v ?? ''); return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str; };
  const cur = wallet.value.currency || 'USD';
  const header = ['Date', 'Description', 'Type', `Amount (${cur})`, `Balance (${cur})`, 'Sandbox', 'Reference'];
  const lines = rows.map((l: any) => {
    const amt = (l.kind === 'credit' ? '' : '-') + (Math.abs(l.amountMinor || 0) / 100).toFixed(2);
    const bal = ((l.balanceAfterMinor || 0) / 100).toFixed(2);
    return [fmtDate(l.createdAt), l.reason || '', l.kind || '', amt, bal, l.sandbox ? 'yes' : 'no', l.reference || ''].map(esc).join(',');
  });
  const csv = [header.join(','), ...lines].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `telroi-transactions-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
  if (!rows.length) toast.ok('No transactions in the last 30 days'); else toast.ok(`Exported ${rows.length} transaction${rows.length > 1 ? 's' : ''}`);
}
const summary = ref<any>({ moneyInMinor: 0, moneyOutMinor: 0, avgInMinor: 0, avgOutMinor: 0 });
const selected = ref<any>(null);
const amountMajor = ref(50);
const topping = ref(false);
const monthDate = ref(new Date());
// Monnify bank-transfer account
const account = ref<any>(null);
const kyc = ref('');
const fundTab = ref('transfer');
const creatingAcct = ref(false);
const copied = ref(false);

const provider = computed(() => wallet.value.currency === 'NGN' ? 'Paystack' : 'Stripe');
const quickAmounts = computed(() => wallet.value.currency === 'NGN' ? [5000, 20000, 50000, 100000] : [25, 50, 100, 250]);
const bal = computed(() => money.parts(wallet.value.balanceMinor, wallet.value.currency));
const mIn = computed(() => money.parts(summary.value.moneyInMinor, wallet.value.currency));
const mOut = computed(() => money.parts(summary.value.moneyOutMinor, wallet.value.currency));
const avgIn = computed(() => money.parts(summary.value.avgInMinor, wallet.value.currency));
const avgOut = computed(() => money.parts(summary.value.avgOutMinor, wallet.value.currency));
const monthLabel = computed(() => monthDate.value.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }));
const isCurrentMonth = computed(() => monthDate.value.toISOString().slice(0, 7) === new Date().toISOString().slice(0, 7));

function part(m: number) { return money.parts(m, wallet.value.currency); }
function fmtDate(iso: string) { return new Date(iso).toLocaleDateString(undefined, { month: '2-digit', day: '2-digit', year: '2-digit' }); }
function fmtDateTime(iso: string) { return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }
function describe(reason: string) {
  return ({ topup: 'Wallet top-up', voice_minute: 'Voice airtime', plan_fee: 'Plan fee', did_monthly: 'Number rental', channel_monthly: 'Voice channel' } as any)[reason] || reason;
}

async function loadSummary() {
  const monthStr = monthDate.value.toISOString().slice(0, 7);
  try { summary.value = await api.get<any>('/api/wallet/summary', { month: monthStr }); } catch { /* */ }
}
async function load() {
  pending.value = true;
  try {
    const [w, l] = await Promise.all([api.get<any>('/api/wallet'), api.get<any[]>('/api/wallet/ledger')]);
    wallet.value = w; ledger.value = l;
    await loadSummary();
    if (w.currency === 'NGN') await loadAccount();
  } catch (e: any) { toast.err(e.message); }
  finally { pending.value = false; }
}
async function loadAccount() {
  try { const r = await api.get<any>('/api/wallet/account'); account.value = r.account; } catch { /* */ }
}
async function createAccount() {
  creatingAcct.value = true;
  try {
    const r = await api.post<any>('/api/wallet/account', kyc.value.startsWith('0') ? { nin: kyc.value } : { bvn: kyc.value });
    account.value = r.account;
    toast.ok('Account number created');
  } catch (e: any) { toast.err(e.message); }
  finally { creatingAcct.value = false; }
}
function copy(text: string) {
  navigator.clipboard.writeText(text);
  copied.value = true;
  setTimeout(() => (copied.value = false), 1500);
}
function changeMonth(delta: number) {
  const d = new Date(monthDate.value); d.setMonth(d.getMonth() + delta); monthDate.value = d; loadSummary();
}
async function topup() {
  topping.value = true;
  try {
    const minor = Math.round(amountMajor.value * 100);
    const r = await api.post<{ authorizationUrl: string }>('/api/wallet/topup', { amountMinor: minor });
    if (r.authorizationUrl) window.location.href = r.authorizationUrl;
    else toast.err('Could not start checkout');
  } catch (e: any) { toast.err(e.message); topping.value = false; }
}

onMounted(async () => {
  await load();
  if (route.query.ref) { toast.info('Confirming your payment…'); setTimeout(load, 2500); }
});
</script>

<style scoped>
.wal-pagehead { display: flex; align-items: flex-start; justify-content: space-between; }

.wal-top { display: grid; grid-template-columns: 380px 1fr; gap: 20px; margin-bottom: 32px; }

/* Stored card */
.wal-card {
  position: relative; overflow: hidden;
  background: linear-gradient(135deg, var(--signal-2) 0%, var(--signal) 55%, var(--signal-bright) 100%);
  color: #fff; border-radius: 16px; padding: 22px 24px;
  min-height: 210px; display: flex; flex-direction: column;
  box-shadow: 0 12px 30px -12px rgba(26,75,114,0.5);
}
.wal-card-sheen { position: absolute; inset: 0; background: radial-gradient(120% 80% at 80% 0%, rgba(255,255,255,0.18), transparent 60%); pointer-events: none; }
.wal-card-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 28px; }
.wal-card-brand { font-family: var(--font-display); font-size: 20px; letter-spacing: -0.01em; }
.wal-card-chip { opacity: 0.85; }
.wal-card-label { font-size: 12px; color: rgba(255,255,255,0.7); margin-bottom: 6px; }
.wal-card-balance { font-size: 34px; font-weight: 600; letter-spacing: -0.02em; }
.wal-card-balance .cents { font-size: 0.6em; }
.wal-card-skel { height: 34px; width: 150px; background: rgba(255,255,255,0.2); }
.wal-card-foot { margin-top: auto; padding-top: 22px; display: flex; align-items: flex-end; justify-content: space-between; }
.wal-card-foot-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; color: rgba(255,255,255,0.6); margin-bottom: 3px; }
.wal-card-foot-val { font-size: 14px; }
.wal-card-foot-right { display: flex; flex-direction: column; align-items: flex-end; gap: 3px; }
.wal-card-cur { font-size: 13px; font-weight: 600; letter-spacing: 0.04em; }
.wal-card-plan { font-size: 11px; color: rgba(255,255,255,0.7); text-transform: capitalize; }

/* Funding panel */
.wal-fund { border: 1px solid var(--rule); border-radius: var(--radius); background: var(--paper); overflow: hidden; }
.wal-fund-tabs { display: flex; border-bottom: 1px solid var(--rule); }
.wal-fund-tab { flex: 1; padding: 13px; font-size: 13.5px; font-weight: 500; color: var(--ink-soft); border-bottom: 2px solid transparent; transition: all 0.12s; }
.wal-fund-tab.on { color: var(--signal); border-bottom-color: var(--signal); }
.wal-fund-body { padding: 22px 24px; }
.wal-fund-lede { font-size: 13.5px; color: var(--ink-soft); margin-bottom: 18px; line-height: 1.5; }

.wal-acct { border: 1px solid var(--rule); border-radius: var(--radius); overflow: hidden; }
.wal-acct-row { display: flex; align-items: center; justify-content: space-between; padding: 13px 16px; border-bottom: 1px solid var(--rule-2); }
.wal-acct-row:last-child { border-bottom: none; }
.wal-acct-k { font-size: 13px; color: var(--ink-soft); }
.wal-acct-v { font-size: 14px; font-weight: 500; }
.wal-acct-num { font-size: 16px; display: flex; align-items: center; gap: 10px; }
.wal-copy { font-size: 11px; color: var(--signal); border: 1px solid var(--signal-soft); background: var(--signal-soft); padding: 3px 9px; border-radius: 6px; }

.wal-quick { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 16px; }
.wal-quick-btn { padding: 10px; border: 1px solid var(--rule); border-radius: var(--radius); font-size: 13px; font-weight: 500; transition: all 0.14s; }
.wal-quick-btn:hover { border-color: var(--signal-bright); }
.wal-quick-btn.on { border-color: var(--signal); background: var(--signal-soft); color: var(--signal); }
.wal-pay-note { font-size: 12px; margin-top: 10px; text-align: center; }

.wal-movement-head, .wal-tx-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
.wal-section-title { font-size: 17px; font-weight: 600; letter-spacing: -0.01em; }
.wal-month-nav { display: flex; align-items: center; gap: 14px; }
.wal-month { font-size: 14px; color: var(--ink-soft); min-width: 110px; text-align: center; }
.wal-month-btn { width: 26px; height: 26px; border-radius: var(--radius-sm); border: 1px solid var(--rule); color: var(--ink-soft); font-size: 14px; transition: all 0.12s; }
.wal-month-btn:hover:not(:disabled) { background: var(--paper-2); color: var(--ink); }
.wal-month-btn:disabled { opacity: 0.4; cursor: default; }

.wal-movement { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 32px; }
.wal-move-card { padding: 0; }
.wal-move-label { font-size: 13px; color: var(--ink-soft); margin-bottom: 12px; }
.wal-move-amount { font-size: 30px; font-weight: 600; letter-spacing: -0.02em; }
.wal-move-foot { padding: 14px 24px; border-top: 1px solid var(--rule-2); font-size: 13px; }
.wal-move-avg { display: flex; align-items: center; justify-content: space-between; }

.wal-ledger { overflow: hidden; }
.loading-pad { padding: 16px 24px; display: flex; flex-direction: column; gap: 12px; }
.skel-row { height: 20px; }
.wal-date { white-space: nowrap; font-size: 13.5px; }
.wal-desc { display: flex; align-items: center; gap: 11px; }
.wal-desc-icon { width: 26px; height: 26px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-size: 13px; flex-shrink: 0; }
.wal-desc-icon.credit { background: rgba(0,210,138,0.12); color: #0a8a5c; }
.wal-desc-icon.debit { background: var(--paper-3); color: var(--ink-soft); }
.wal-chev { color: var(--ink-mute); text-align: right; width: 20px; }

.drawer-overlay { position: fixed; inset: 0; z-index: 150; background: rgba(10,10,11,0.28); display: flex; justify-content: flex-end; }
.drawer { width: 420px; max-width: 92vw; background: var(--paper); height: 100%; padding: 28px; overflow-y: auto; box-shadow: var(--shadow-pop); }
.drawer-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; }
.drawer-kicker { font-size: 12px; letter-spacing: 0.04em; text-transform: uppercase; color: var(--ink-mute); }
.modal-x { color: var(--ink-mute); }
.drawer-amount { font-size: 34px; font-weight: 600; letter-spacing: -0.02em; margin-bottom: 4px; }
.drawer-sub { font-size: 13.5px; color: var(--ink-soft); margin-bottom: 28px; }
.drawer-timeline { margin-bottom: 24px; }
.drawer-dl > div { display: flex; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid var(--rule-2); }
.drawer-dl dt { color: var(--ink-soft); font-size: 13px; }
.drawer-dl dd { font-size: 13.5px; }

.modal-overlay { position: fixed; inset: 0; z-index: 200; background: rgba(10,10,11,0.32); display: flex; align-items: center; justify-content: center; padding: 24px; }
.modal { width: 100%; max-width: 420px; }
.wal-pay-note { font-size: 12px; margin-top: 10px; text-align: center; }
.wal-pay-note { font-size: 12px; margin-top: 10px; text-align: center; }

.drawer-enter-active, .drawer-leave-active { transition: opacity .2s; }
.drawer-enter-from, .drawer-leave-to { opacity: 0; }
@media (max-width: 820px) { .wal-movement { grid-template-columns: 1fr; } .wal-top { grid-template-columns: 1fr; } }
.sbx-badge { display: inline-block; margin-left: 8px; padding: 1px 7px; font-size: 10.5px; font-weight: 600; border-radius: 999px; background: var(--warn, #b7791f); color: #fff; vertical-align: middle; letter-spacing: 0.02em; }
</style>
