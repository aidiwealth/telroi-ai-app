<template>
  <div>
    <h1 class="ad-title">Pricing</h1>
    <p class="ad-sub">Global rates, in dollars. Per-client overrides are set on each client's detail page.</p>

    <div v-if="pending" class="ad-loading">Loading…</div>
    <div v-else class="ad-panel">
      <div class="ad-rate-grid">
        <div class="ad-field"><label>Airtime ($/min)</label>
          <input v-model="airtime" class="ad-input mono" disabled />
          <span class="ad-hint">Fixed at $0.0102/min (sub-cent, billed per call)</span>
        </div>
        <div class="ad-field"><label>Number / DID ($/mo)</label>
          <input v-model.number="did" type="number" step="0.01" class="ad-input mono" />
        </div>
        <div class="ad-field"><label>Channel ($/mo)</label>
          <input v-model.number="channel" type="number" step="0.01" class="ad-input mono" />
        </div>
        <div class="ad-field"><label>Startup plan ($/user/mo)</label>
          <input v-model.number="startup" type="number" step="0.01" class="ad-input mono" />
        </div>
        <div class="ad-field"><label>Growth plan ($/user/mo)</label>
          <input v-model.number="growth" type="number" step="0.01" class="ad-input mono" />
        </div>
        <div class="ad-field"><label>Exchange rate — NGN per USD</label>
          <input v-model.number="ngn" type="number" min="1" step="1" class="ad-input mono" />
          <p class="ad-hint">$1 USD = ₦{{ ngn || 0 }}. This is the platform-wide rate — it drives every USD→Naira conversion for Nigerian wallets, plan fees, number/channel billing and per-minute call charges. Applies immediately on save.</p>
        </div>
      </div>
      <button class="btn btn-signal" :disabled="saving" @click="save">{{ saving ? 'Saving…' : 'Save rates' }}</button>
      <span v-if="saved" class="ad-saved">✓ Saved</span>
    </div>

    <!-- Billing operations: live state of recurring billing + channels. -->
    <h2 class="ad-title bops-title">Billing operations</h2>
    <p class="ad-sub">Recurring monthly billing for numbers, channels and plans. This shows the live state and lets you run billing on demand — prices are set above.</p>
    <div v-if="bops" class="ad-panel">
      <div class="bops-stats">
        <div class="bops-stat"><div class="bops-num">{{ bops.numbers.dueCount }}</div><div class="bops-lab">Numbers due</div></div>
        <div class="bops-stat"><div class="bops-num">{{ bops.plans.dueCount }}</div><div class="bops-lab">Plan fees due</div></div>
        <div class="bops-stat" :class="{ warn: bops.numbers.suspendedCount > 0 }"><div class="bops-num">{{ bops.numbers.suspendedCount }}</div><div class="bops-lab">Suspended</div></div>
        <div class="bops-stat"><div class="bops-num small">{{ bops.lastRunAt ? fmtDate(bops.lastRunAt) : 'Never' }}</div><div class="bops-lab">Last run</div></div>
      </div>
      <div class="bops-actions">
        <button class="btn btn-signal btn-sm" :disabled="running" @click="runBilling">{{ running ? 'Running…' : 'Run billing now' }}</button>
        <span class="ad-hint">In production this runs automatically via the daily billing cron. Use this to run it on demand.</span>
      </div>
      <div v-if="runResult" class="bops-result">
        Charged {{ runResult.charged }} number(s), {{ runResult.plans?.charged || 0 }} plan(s); {{ runResult.suspended }} suspended, {{ runResult.skipped }} already billed.
      </div>

      <div v-if="bops.numbers.suspended.length" class="bops-section">
        <h3 class="bops-h3">Suspended for non-payment</h3>
        <table class="ad-table">
          <thead><tr><th>Number</th><th>Region</th><th>Carrier</th><th>Channels</th></tr></thead>
          <tbody>
            <tr v-for="s in bops.numbers.suspended" :key="s.telnum">
              <td class="mono">{{ s.telnum }}</td><td>{{ s.region }}</td><td>{{ s.provider }}</td><td>{{ s.channels }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-if="bops.channels.length" class="bops-section">
        <h3 class="bops-h3">Channel capacity by client</h3>
        <table class="ad-table">
          <thead><tr><th>Client</th><th>Channels (capacity)</th></tr></thead>
          <tbody>
            <tr v-for="c in bops.channels" :key="c.tenantId">
              <td>{{ c.name }}</td><td class="mono">{{ c.capacity }}</td>
            </tr>
          </tbody>
        </table>
        <p class="ad-hint">Capacity = simultaneous calls a client can place/receive, billed monthly per channel. Enforced live at call time.</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
definePageMeta({ layout: 'admin', middleware: 'superadmin' });
useHead({ title: 'Pricing — Telroi Operator' });

const pending = ref(true);
const saving = ref(false);
const saved = ref(false);
const airtime = ref('0.0102');
const did = ref(1.70);
const channel = ref(2.00);
const startup = ref(10);
const growth = ref(15);
const ngn = ref(1600);
const bops = ref<any>(null);
const running = ref(false);
const runResult = ref<any>(null);
function fmtDate(s: string) { try { return new Date(s).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch { return s; } }
async function loadBops() { try { bops.value = await $fetch<any>('/api/admin/billing/status'); } catch { /* */ } }
async function runBilling() {
  running.value = true; runResult.value = null;
  try {
    runResult.value = await $fetch<any>('/api/admin/billing/run', { method: 'POST' });
    await loadBops();
  } catch (e: any) { alert(e?.data?.error?.message || 'Billing run failed'); }
  finally { running.value = false; }
}

async function load() {
  pending.value = true;
  try {
    const { pricing } = await $fetch<any>('/api/admin/pricing');
    if (pricing) {
      did.value = pricing.didMonthlyUsdMinor / 100;
      channel.value = pricing.channelMonthlyUsdMinor / 100;
      startup.value = pricing.planStartupUsdMinor / 100;
      growth.value = pricing.planGrowthUsdMinor / 100;
      ngn.value = pricing.ngnPerUsd;
    }
  } catch { await navigateTo('/admin/login'); }
  finally { pending.value = false; }
  loadBops();
}
async function save() {
  saving.value = true; saved.value = false;
  try {
    await $fetch('/api/admin/pricing', { method: 'POST', body: {
      didMonthlyUsdMinor: Math.round(did.value * 100),
      channelMonthlyUsdMinor: Math.round(channel.value * 100),
      planStartupUsdMinor: Math.round(startup.value * 100),
      planGrowthUsdMinor: Math.round(growth.value * 100),
      ngnPerUsd: Math.round(ngn.value)
    } });
    saved.value = true;
  } catch (e: any) { alert(e?.data?.error?.message || 'Save failed'); }
  finally { saving.value = false; }
}
onMounted(load);
</script>

<style scoped>
.ad-title { font-family: var(--font-display); font-size: 30px; color: var(--ink); letter-spacing: -0.02em; }
.ad-sub { color: var(--ink-mute); font-size: 14px; margin: 4px 0 28px; }
.ad-loading { color: var(--ink-mute); padding: 40px 0; }
.ad-panel { background: var(--paper); border-radius: var(--radius-lg); padding: 28px; max-width: 620px; }
.ad-rate-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 22px; }
.ad-field { display: flex; flex-direction: column; gap: 6px; }
.ad-field label { font-size: 13px; font-weight: 500; }
.ad-input { padding: 11px 14px; border: 1px solid var(--rule); border-radius: var(--radius); font-size: 14.5px; outline: none; }
.ad-input:focus { border-color: var(--signal); box-shadow: 0 0 0 3px var(--signal-soft); }
.ad-input:disabled { background: var(--paper-2); color: var(--ink-soft); }
.ad-hint { font-size: 11.5px; color: var(--ink-mute); }
.ad-saved { color: #0a8a5c; font-size: 13px; margin-left: 12px; }
.bops-title { margin-top: 32px; }
.bops-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin-bottom: 20px; }
.bops-stat { background: var(--paper); border: 1px solid var(--rule); border-radius: var(--radius, 12px); padding: 16px 18px; display: flex; flex-direction: column; gap: 4px; transition: border-color .12s; }
.bops-stat.warn { border-color: var(--danger); background: rgba(192,57,43,0.04); }
.bops-num { font-family: var(--font-display); font-size: 26px; font-weight: 600; color: var(--ink); line-height: 1.1; letter-spacing: -.01em; }
.bops-num.small { font-size: 15px; font-weight: 600; font-family: inherit; }
.bops-stat.warn .bops-num { color: var(--danger); }
.bops-lab { font-size: 12px; color: var(--ink-mute); text-transform: uppercase; letter-spacing: .04em; }
.bops-actions { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; margin-bottom: 14px; }
.bops-result { background: var(--signal-soft, var(--paper-2)); border: 1px solid var(--rule); border-radius: 10px; padding: 11px 14px; font-size: 13px; color: var(--ink-soft); margin-bottom: 18px; }
.bops-section { margin-top: 22px; padding-top: 18px; border-top: 1px solid var(--rule); }
.bops-h3 { font-size: 13px; font-weight: 600; color: var(--ink); margin: 0 0 12px; text-transform: uppercase; letter-spacing: .04em; }
/* Tables inside the billing-ops panel (ad-table is scoped per-page, so define it here). */
.bops-section .ad-table { width: 100%; border-collapse: collapse; border: 1px solid var(--rule); border-radius: var(--radius, 10px); overflow: hidden; }
.bops-section .ad-table th { text-align: left; font-family: var(--font-mono); font-size: 10.5px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink-mute); font-weight: 500; padding: 12px 16px; border-bottom: 1px solid var(--rule); background: var(--paper-2); }
.bops-section .ad-table td { padding: 12px 16px; border-bottom: 1px solid var(--rule-2); color: var(--ink); font-size: 14px; }
.bops-section .ad-table tbody tr:last-child td { border-bottom: none; }
.bops-section .ad-hint { margin-top: 10px; }
@media (max-width: 720px) { .bops-stats { grid-template-columns: repeat(2, 1fr); } }

</style>
