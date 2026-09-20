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
        <!-- Charged per verification rather than per minute: a client sending
             OTPs wants a figure they can multiply, and the call is always
             about the same length. Per-region rates below override this. -->
        <div class="ad-field"><label>Voice OTP ($/verification)</label>
          <input v-model.number="otp" type="number" step="0.001" min="0" class="ad-input mono" />
          <p class="ad-hint">One price whatever the destination, unless a region below sets its own. Charged when the call is placed, and refused beforehand if the wallet cannot cover it.</p>
        </div>
        <!-- Per unit, not per minute. A unit is 160 characters or 30 seconds of
             audio, whichever comes first — sold that way because SMS segments
             are how this market already thinks about messaging, and because
             characters and seconds diverge badly on numerals. -->
        <div class="ad-field"><label>Voice notification ($/unit)</label>
          <input v-model.number="notifyUnit" type="number" step="0.001" min="0" class="ad-input mono" />
          <p class="ad-hint">One unit is 160 characters or 30 seconds of audio, whichever is reached first. A longer message costs more units; it is never cut short.</p>
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
        <!-- A price rather than a discount: "$150 a year" is something somebody
             can quote, and 16.67% is not. The saving beneath is worked out from
             the two figures, which also catches a mistyped one — $15 entered
             where $150 was meant shows a 92% saving at a glance. -->
        <div class="ad-field"><label>AI daily cap ($/workspace)</label>
          <input v-model.number="aiDailyCap" type="number" step="0.01" min="0" class="ad-input mono" />
          <p class="ad-hint">Managed AI stops answering once a workspace spends this in a day; calls fall through to whoever the number escalates to. 0 removes the ceiling. A client can set their own lower.</p>
        </div>
        <div class="ad-field"><label>Startup plan ($/yr)</label>
          <input v-model.number="startupAnnual" type="number" step="0.01" class="ad-input mono" />
          <p class="ad-hint">{{ saveStartupPct }}% off twelve months — about {{ startup > 0 ? Math.round((startup * 12 - startupAnnual) / startup * 10) / 10 : 0 }} months free.</p>
        </div>
        <div class="ad-field"><label>Growth plan ($/yr)</label>
          <input v-model.number="growthAnnual" type="number" step="0.01" class="ad-input mono" />
          <p class="ad-hint">{{ saveGrowthPct }}% off twelve months — about {{ growth > 0 ? Math.round((growth * 12 - growthAnnual) / growth * 10) / 10 : 0 }} months free.</p>
        </div>
        <div class="ad-field"><label>Transcription — per minute</label>
          <input v-model.number="transcription" type="number" min="0" step="0.001" class="ad-input mono" />
          <p class="ad-hint">Charged only when a client asks for a transcript, not on every recording — most are never listened to, let alone read. The vendor costs us about $0.006 a minute, so this is where the margin sits. Storage itself is pennies and is not charged.</p>
        </div>
        <div class="ad-field"><label>Recording kept — Startup plan</label>
          <input v-model.number="recDaysStartup" type="number" min="1" max="365" step="1" class="ad-input mono" />
          <p class="ad-hint">Days before a recording is deleted. Applies to recordings stored from now on; anything already kept keeps the term it was given, so shortening this does not delete what somebody already has.</p>
        </div>
        <div class="ad-field"><label>Recording kept — Growth plan</label>
          <input v-model.number="recDaysGrowth" type="number" min="1" max="365" step="1" class="ad-input mono" />
          <p class="ad-hint">The same, for Growth. Transcripts are kept as long as their recording.</p>
        </div>
        <div class="ad-field"><label>Exchange rate — NGN per USD</label>
          <input v-model.number="ngn" type="number" min="1" step="1" class="ad-input mono" />
          <p class="ad-hint">$1 USD = ₦{{ ngn || 0 }}. This is the platform-wide rate — it drives every USD→Naira conversion for Nigerian wallets, plan fees, number/channel billing and per-minute call charges. Applies immediately on save.</p>
        </div>
      </div>
      <button class="btn btn-signal" :disabled="saving" @click="save">{{ saving ? 'Saving…' : 'Save rates' }}</button>
      <span v-if="saved" class="ad-saved">✓ Saved</span>
    </div>

    <!-- Between the global rates above and any per-client override: a
         verification to Lagos and one to Chicago cost us differently and were
         priced the same. Blank inherits, so the difference between "not set"
         and "set to zero" stays visible. -->
    <h2 class="ad-title bops-title">Rates by region</h2>
    <p class="ad-sub">Where the call lands, not where the client is. Blank uses the global rate above.</p>
    <div class="ad-panel">
      <table class="ad-table rg-table">
        <thead>
          <tr>
            <th>Region</th>
            <th>Voice OTP ($/verification)</th>
            <th>Notification ($/unit)</th>
            <th>Airtime ($/min)</th>
            <th>Where the figure came from</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in regions" :key="r.region">
            <td><strong>{{ r.label }}</strong> <span class="ad-hint">{{ r.region }}</span></td>
            <td>
              <input v-model="r._otp" type="number" step="0.001" min="0"
                     class="ad-input mono rg-input" :placeholder="String(otp)" />
            </td>
            <td>
              <input v-model="r._unit" type="number" step="0.001" min="0"
                     class="ad-input mono rg-input" :placeholder="String(notifyUnit)" />
            </td>
            <td>
              <input v-model="r._min" type="number" step="0.0001" min="0"
                     class="ad-input mono rg-input" :placeholder="String(airtime)" />
            </td>
            <td>
              <input v-model="r.notes" class="ad-input rg-notes"
                     placeholder="Which carrier invoice this came from" />
            </td>
            <td>
              <button class="btn btn-ghost btn-sm" :disabled="r._busy" @click="saveRegion(r)">
                {{ r._busy ? 'Saving…' : 'Save' }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
      <p class="ad-hint rg-foot">
        A rate with no note is one nobody dares change six months on. Worth saying
        which invoice it came from.
      </p>
    </div>

    <h2 class="ad-title bops-title">Managed AI pricing</h2>
    <p class="ad-sub">What managed-tier AI costs clients (BYOK agents run on the client's own keys and aren't billed here). LLM rates are per 1M tokens, TTS per 1M characters. A markup can be added on top of raw provider cost.</p>
    <div v-if="!pending" class="ad-panel">
      <div class="ad-rate-grid">
        <div class="ad-field"><label>Speech-to-text ($/min)</label>
          <input v-model.number="aiSttPerMin" type="number" step="0.0001" min="0" class="ad-input mono" />
        </div>
        <div class="ad-field"><label>LLM input ($/1M tokens)</label>
          <input v-model.number="aiLlmInPerM" type="number" step="0.01" min="0" class="ad-input mono" />
        </div>
        <div class="ad-field"><label>LLM output ($/1M tokens)</label>
          <input v-model.number="aiLlmOutPerM" type="number" step="0.01" min="0" class="ad-input mono" />
        </div>
        <div class="ad-field"><label>Text-to-speech ($/1M chars)</label>
          <input v-model.number="aiTtsPerM" type="number" step="0.01" min="0" class="ad-input mono" />
        </div>
        <div class="ad-field"><label>Platform markup (%)</label>
          <input v-model.number="aiMarkup" type="number" step="1" min="0" max="1000" class="ad-input mono" />
          <span class="ad-hint">Added on top of the raw AI cost. 0 = pass-through.</span>
        </div>
      </div>
      <button class="btn btn-signal" :disabled="savingAi" @click="saveAi">{{ savingAi ? 'Saving…' : 'Save AI pricing' }}</button>
      <span v-if="savedAi" class="ad-saved">✓ Saved</span>
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
import { useAdminApi } from '~/composables/useAdminApi';
definePageMeta({ layout: 'admin', middleware: 'superadmin' });
useHead({ title: 'Pricing — Telroi Operator' });

const pending = ref(true);
const loadError = ref('');
const adminApi = useAdminApi();
const saving = ref(false);
const saved = ref(false);
const airtime = ref('0.0102');
const did = ref(1.70);
// Dollars here, micro-dollars on the wire. $0.01 is the seeded default.
const otp = ref(0.01);
const notifyUnit = ref(0.0075);

/* Region rates. Held as dollars for the form and converted at the edges, the
   same way the global figures are — micro-dollars on the wire because a
   verification costs a fraction of a cent to us. */
const regions = ref<any[]>([]);

async function loadRegions() {
  try {
    // adminApi, not api: this page is admin-session scoped and the other calls
    // on it use that. Using the wrong one failed silently and left an empty
    // table, which read as a screen with nothing to show rather than a fault.
    const r = await adminApi.get<any>('/api/admin/pricing/regions');
    regions.value = (r?.regions || []).map((x: any) => ({
      ...x,
      // Empty string rather than 0 for an unset rate: the placeholder then
      // shows the global figure being inherited, where a 0 would look like a
      // deliberate free call.
      _otp: x.voiceOtpUsdMicro == null ? '' : x.voiceOtpUsdMicro / 1000000,
      _unit: x.voiceNotifyUnitUsdMicro == null ? '' : x.voiceNotifyUnitUsdMicro / 1000000,
      _min: x.voiceMinuteUsdMicro == null ? '' : x.voiceMinuteUsdMicro / 1000000,
      _busy: false
    }));
  } catch (e) {
    console.error('[pricing] could not load region rates:', e);
    regions.value = [];
  }
}

async function saveRegion(r: any) {
  r._busy = true;
  try {
    // Null clears an override back to the global rate. Sending 0 instead would
    // price the region at nothing, which is a different and expensive thing.
    await adminApi.post<any>('/api/admin/pricing/regions', {
      region: r.region,
      voiceOtpUsdMicro: r._otp === '' || r._otp == null ? null : Math.round(Number(r._otp) * 1000000),
      voiceNotifyUnitUsdMicro: r._unit === '' || r._unit == null ? null : Math.round(Number(r._unit) * 1000000),
      voiceMinuteUsdMicro: r._min === '' || r._min == null ? null : Math.round(Number(r._min) * 1000000),
      notes: r.notes || null
    });
  } catch (e: any) {
    alert(e?.message || 'Could not save that region.');
  } finally {
    r._busy = false;
  }
}
const channel = ref(2.00);
const startup = ref(10);
const growth = ref(15);
// Annual is a price, not a discount off the monthly one. The saving shown to a
// client is worked out from the two figures, so nobody has to keep a percentage
// in step with a price.
// What managed AI may spend for one workspace in a day, before its calls stop
// being answered by AI and fall through to a person. Zero removes the ceiling.
const aiDailyCap = ref(5);
const startupAnnual = ref(100);
const growthAnnual = ref(150);
const saveStartupPct = computed(() => startup.value > 0
  ? Math.floor((1 - startupAnnual.value / (startup.value * 12)) * 100) : 0);
const saveGrowthPct = computed(() => growth.value > 0
  ? Math.floor((1 - growthAnnual.value / (growth.value * 12)) * 100) : 0);
const ngn = ref(1600);

// Managed AI pricing (display units: $/min for STT, $/1M for LLM+TTS, % markup).
const savingAi = ref(false);
const savedAi = ref(false);
const aiSttPerMin = ref(0);
const aiLlmInPerM = ref(0);
const aiLlmOutPerM = ref(0);
const aiTtsPerM = ref(0);
const aiMarkup = ref(0);
const bops = ref<any>(null);
const running = ref(false);
const runResult = ref<any>(null);
function fmtDate(s: string) { try { return new Date(s).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch { return s; } }
async function loadBops() { try { bops.value = await adminApi.get<any>('/api/admin/billing/status'); } catch { /* */ } }
async function runBilling() {
  running.value = true; runResult.value = null;
  try {
    runResult.value = await adminApi.post<any>('/api/admin/billing/run');
    await loadBops();
  } catch (e: any) { alert(e?.data?.error?.message || 'Billing run failed'); }
  finally { running.value = false; }
}

const transcription = ref(0.02);
const recDaysStartup = ref(7);
const recDaysGrowth = ref(30);

async function load() {
  pending.value = true;
  try {
    const { pricing } = await adminApi.get<any>('/api/admin/pricing');
    if (pricing) {
      did.value = pricing.didMonthlyUsdMinor / 100;
      // Micro-dollars on the wire, dollars on the screen.
      otp.value = (pricing.voiceOtpUsdMicro ?? 10000) / 1000000;
      notifyUnit.value = (pricing.voiceNotifyUnitUsdMicro ?? 7500) / 1000000;
      await loadRegions();
      channel.value = pricing.channelMonthlyUsdMinor / 100;
      startup.value = pricing.planStartupUsdMinor / 100;
      growth.value = pricing.planGrowthUsdMinor / 100;
      aiDailyCap.value = (pricing.aiDailyCapUsdMinor ?? 500) / 100;
      startupAnnual.value = (pricing.planStartupAnnualUsdMinor ?? pricing.planStartupUsdMinor * 12) / 100;
      growthAnnual.value = (pricing.planGrowthAnnualUsdMinor ?? pricing.planGrowthUsdMinor * 12) / 100;
      ngn.value = pricing.ngnPerUsd;
      // Micro to dollars for reading, back again on save — the same handling as
      // airtime, since a cent cannot express two thousandths of one.
      if (pricing.transcriptionMinuteUsdMicro != null) transcription.value = pricing.transcriptionMinuteUsdMicro / 1e6;
      if (pricing.recordingDaysStartup != null) recDaysStartup.value = pricing.recordingDaysStartup;
      if (pricing.recordingDaysGrowth != null) recDaysGrowth.value = pricing.recordingDaysGrowth;
      if (pricing.aiSttPerSecNano != null) aiSttPerMin.value = Math.round((pricing.aiSttPerSecNano / 1e9) * 60 * 1e6) / 1e6;
      if (pricing.aiLlmInPerTokNano != null) aiLlmInPerM.value = Math.round((pricing.aiLlmInPerTokNano / 1000) * 100) / 100;
      if (pricing.aiLlmOutPerTokNano != null) aiLlmOutPerM.value = Math.round((pricing.aiLlmOutPerTokNano / 1000) * 100) / 100;
      if (pricing.aiTtsPerCharNano != null) aiTtsPerM.value = Math.round((pricing.aiTtsPerCharNano / 1000) * 100) / 100;
      if (pricing.aiMarkupPct != null) aiMarkup.value = pricing.aiMarkupPct;
    }
  } catch (e: any) {
    // 401 is handled centrally by useAdminApi (redirects to login). Anything
    // else (403, 500, network) surfaces here without logging the operator out.
    loadError.value = e?.message || 'Could not load pricing.';
  }
  finally { pending.value = false; }
  loadBops();
}
async function save() {
  saving.value = true; saved.value = false;
  try {
    await adminApi.post('/api/admin/pricing', {
      didMonthlyUsdMinor: Math.round(did.value * 100),
      voiceOtpUsdMicro: Math.round(otp.value * 1000000),
      voiceNotifyUnitUsdMicro: Math.round(notifyUnit.value * 1000000),
      channelMonthlyUsdMinor: Math.round(channel.value * 100),
      planStartupUsdMinor: Math.round(startup.value * 100),
      planGrowthUsdMinor: Math.round(growth.value * 100),
      aiDailyCapUsdMinor: Math.round(aiDailyCap.value * 100),
      planStartupAnnualUsdMinor: Math.round(startupAnnual.value * 100),
      planGrowthAnnualUsdMinor: Math.round(growthAnnual.value * 100),
      ngnPerUsd: Math.round(ngn.value),
      transcriptionMinuteUsdMicro: Math.round(transcription.value * 1e6),
      recordingDaysStartup: Math.round(recDaysStartup.value),
      recordingDaysGrowth: Math.round(recDaysGrowth.value)
    });
    saved.value = true;
  } catch (e: any) { alert(e?.message || 'Save failed'); }
  finally { saving.value = false; }
}

async function saveAi() {
  savingAi.value = true; savedAi.value = false;
  try {
    await adminApi.post('/api/admin/pricing', {
      aiSttPerSecNano: Math.round((aiSttPerMin.value / 60) * 1e9),
      aiLlmInPerTokNano: Math.round(aiLlmInPerM.value * 1000),
      aiLlmOutPerTokNano: Math.round(aiLlmOutPerM.value * 1000),
      aiTtsPerCharNano: Math.round(aiTtsPerM.value * 1000),
      aiMarkupPct: Math.round(aiMarkup.value)
    });
    savedAi.value = true;
  } catch (e: any) { alert(e?.message || 'Save failed'); }
  finally { savingAi.value = false; }
}
onMounted(load);
</script>

<style scoped>
/* Region rates. Narrow inputs so a rate reads as a figure rather than a form
   field, and a wide notes column because provenance is the thing most likely to
   be skipped and most useful later. */
.rg-table { width: 100%; }
.rg-table th { font-size: 11px; text-transform: uppercase; letter-spacing: .06em;
  color: var(--ink-mute); text-align: left; padding: 8px 10px; }
.rg-table td { padding: 8px 10px; border-top: 1px solid var(--rule); vertical-align: middle; }
.rg-input { width: 120px; }
.rg-notes { width: 100%; min-width: 220px; font-size: 12.5px; }
.rg-foot { margin: 12px 10px 0; }
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
