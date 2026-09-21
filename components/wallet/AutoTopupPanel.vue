<template>
  <section class="card atp-card" aria-labelledby="auto-topup-title">
    <div class="atp-head">
      <div>
        <h2 id="auto-topup-title" class="atp-title">Automatic top-up</h2>
        <p class="atp-sub">Keep this prepaid wallet funded when its balance runs low.</p>
      </div>
      <span v-if="state" class="atp-status" :class="{ on: state.enabled }">
        {{ state.enabled ? 'On' : 'Off' }}
      </span>
    </div>

    <div v-if="loading" class="atp-loading">
      <div class="skeleton atp-skel-wide" />
      <div class="skeleton atp-skel-short" />
    </div>

    <div v-else-if="loadError" class="atp-body">
      <p class="atp-message" role="alert">{{ loadError }}</p>
      <button type="button" class="btn btn-ghost btn-sm" @click="load">Try again</button>
    </div>

    <div v-else-if="state" class="atp-body">
      <form v-if="editing" @submit.prevent="save">
        <div class="atp-fields">
          <div class="field">
            <label for="atp-threshold">Top up when balance is below</label>
            <div class="atp-money-input">
              <span>{{ symbol }}</span>
              <input
                id="atp-threshold"
                v-model.trim="thresholdMajor"
                class="input mono"
                inputmode="decimal"
                autocomplete="off"
                placeholder="0.00"
              >
            </div>
          </div>
          <div class="field">
            <label for="atp-refill">Amount to add</label>
            <div class="atp-money-input">
              <span>{{ symbol }}</span>
              <input
                id="atp-refill"
                v-model.trim="refillMajor"
                class="input mono"
                inputmode="decimal"
                autocomplete="off"
                placeholder="0.00"
              >
            </div>
          </div>
        </div>

        <p class="atp-limit">
          Minimum refill {{ formatMoney(state.minimumTopupMinor) }}. The refill must be greater than the threshold.
        </p>
        <p v-if="amountError" class="field-error" role="alert">{{ amountError }}</p>

        <div v-if="state.paymentMethod" class="atp-method">
          <span class="atp-method-label">Card to charge</span>
          <span>{{ state.paymentMethod.brand || 'Card' }} ending {{ state.paymentMethod.last4 || '••••' }}</span>
        </div>

        <label class="atp-consent">
          <input v-model="consentAccepted" type="checkbox">
          <span>{{ state.consent.text }}</span>
        </label>

        <div class="atp-actions">
          <button type="submit" class="btn btn-signal btn-sm" :disabled="saving || !!amountError || !consentAccepted">
            {{ saving ? 'Saving…' : state.enabled ? 'Save changes' : 'Enable automatic top-up' }}
          </button>
          <button type="button" class="btn btn-ghost btn-sm" :disabled="saving" @click="editing = false">Cancel</button>
        </div>
      </form>

      <template v-else>
        <p v-if="state.enabled" class="atp-summary">
          When the balance falls below <strong>{{ formatMoney(state.thresholdMinor) }}</strong>, add
          <strong>{{ formatMoney(state.topupAmountMinor) }}</strong>
          <template v-if="state.paymentMethod"> using {{ state.paymentMethod.brand || 'the card' }} ending {{ state.paymentMethod.last4 || '••••' }}</template>.
        </p>
        <p v-else class="atp-message">
          {{ state.eligible ? 'Automatic top-up is off. Turn it on to protect the wallet from running low.' : ineligibleMessage }}
        </p>

        <p v-if="state.enabled && !state.eligible" class="atp-warning" role="alert">{{ ineligibleMessage }}</p>

        <div v-if="state.lastAttempt" class="atp-attempt" :class="`is-${state.lastAttempt.status}`">
          <span class="atp-attempt-dot" />
          <span>{{ attemptMessage }}</span>
        </div>

        <p v-if="!canEdit" class="atp-owner-note">Only the workspace owner can change this setting.</p>

        <div v-else class="atp-actions">
          <button
            v-if="state.eligible"
            type="button"
            class="btn btn-ghost btn-sm"
            @click="openEditor"
          >
            {{ state.enabled ? 'Edit' : 'Set up automatic top-up' }}
          </button>
          <button
            v-if="state.enabled"
            type="button"
            class="btn btn-danger btn-sm"
            :disabled="saving"
            @click="disable"
          >
            {{ saving ? 'Turning off…' : 'Turn off' }}
          </button>
        </div>
      </template>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';

type AutoTopupState = {
  configured: boolean;
  enabled: boolean;
  thresholdMinor: number | null;
  topupAmountMinor: number | null;
  currency: 'USD' | 'NGN';
  minimumTopupMinor: number;
  maximumTopupMinor: number;
  eligible: boolean;
  ineligibleReason: string | null;
  consent: { requiredVersion: string; text: string; acceptedVersion: string | null; acceptedAt: string | null };
  paymentMethod: { provider: string; brand: string | null; last4: string | null; reusable: boolean } | null;
  lastAttempt: {
    status: string;
    reference: string;
    failureCode: string | null;
    amountMinor: number;
    currency: string;
    createdAt: string;
    updatedAt: string;
  } | null;
};

const props = withDefaults(defineProps<{
  canEdit: boolean;
  refreshKey?: number;
}>(), { refreshKey: 0 });

const api = useApi();
const toast = useToast();
const state = ref<AutoTopupState | null>(null);
const loading = ref(true);
const saving = ref(false);
const editing = ref(false);
const loadError = ref('');
const thresholdMajor = ref('');
const refillMajor = ref('');
const consentAccepted = ref(false);

const symbol = computed(() => state.value?.currency === 'NGN' ? '₦' : '$');

function formatMoney(minor: number | null) {
  if (minor === null || !state.value) return '—';
  return new Intl.NumberFormat(undefined, {
    style: 'currency', currency: state.value.currency, minimumFractionDigits: 2
  }).format(minor / 100);
}

function inputValue(minor: number) {
  return (minor / 100).toFixed(2);
}

function toMinor(value: string): number | null {
  const normalized = value.replace(/,/g, '').trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const [whole, fraction = ''] = normalized.split('.');
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(minor) ? minor : null;
}

const amountError = computed(() => {
  if (!state.value) return '';
  const threshold = toMinor(thresholdMajor.value);
  const refill = toMinor(refillMajor.value);
  if (threshold === null || threshold <= 0) return 'Enter a threshold greater than zero with no more than two decimal places.';
  if (refill === null || refill <= 0) return 'Enter a positive refill amount with no more than two decimal places.';
  if (refill < state.value.minimumTopupMinor) return `The smallest refill is ${formatMoney(state.value.minimumTopupMinor)}.`;
  if (refill > state.value.maximumTopupMinor) return `The largest refill is ${formatMoney(state.value.maximumTopupMinor)}.`;
  if (refill <= threshold) return 'The refill amount must be greater than the threshold.';
  return '';
});

const ineligibleMessage = computed(() => ({
  sandbox_workspace: 'Automatic top-up is unavailable while this workspace is in sandbox mode.',
  postpaid_workspace: 'Automatic top-up is only available for prepaid wallets.',
  no_saved_card: 'Save a card during your next wallet top-up before turning on automatic top-up.',
  card_not_reusable: 'Save a card again during your next wallet top-up to continue.',
  unsupported_provider: 'The saved payment method does not support automatic top-up.',
  card_currency_mismatch: 'The saved card is not compatible with this wallet currency.'
}[state.value?.ineligibleReason || ''] || 'Automatic top-up is not currently available.'));

const attemptMessage = computed(() => {
  const attempt = state.value?.lastAttempt;
  if (!attempt) return '';
  const amount = formatMoney(attempt.amountMinor);
  const when = new Date(attempt.updatedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  if (attempt.status === 'succeeded') return `Last automatic top-up: ${amount} received on ${when}.`;
  if (attempt.status === 'failed' && attempt.failureCode === 'authentication_required') {
    return 'Your bank requires you to approve this card again. Make a wallet top-up and select “Save card” to re-authorize future automatic payments.';
  }
  if (attempt.status === 'failed') return `The last automatic payment failed. The wallet was not credited.`;
  if (attempt.status === 'uncertain') return `We are confirming the last automatic payment. Another charge will not be submitted. If this remains here, contact support with reference ${attempt.reference}.`;
  if (attempt.status === 'needs_review') return `The last automatic payment needs support review. Contact support with reference ${attempt.reference}; another charge will not be submitted.`;
  if (attempt.status === 'cancelled') return `The last scheduled top-up was cancelled before the card was charged.`;
  return `An automatic payment of ${amount} is being confirmed.`;
});

async function load() {
  loading.value = true;
  loadError.value = '';
  try { state.value = await api.get<AutoTopupState>('/api/wallet/auto-topup'); }
  catch (error: any) { loadError.value = error.message || 'Could not load automatic top-up.'; }
  finally { loading.value = false; }
}

function openEditor() {
  if (!state.value) return;
  const refill = state.value.topupAmountMinor ?? state.value.minimumTopupMinor;
  const threshold = state.value.thresholdMinor ?? Math.floor(refill / 2);
  thresholdMajor.value = inputValue(threshold);
  refillMajor.value = inputValue(refill);
  consentAccepted.value = false;
  editing.value = true;
}

async function save() {
  if (!state.value || amountError.value || !consentAccepted.value) return;
  const thresholdMinor = toMinor(thresholdMajor.value);
  const topupAmountMinor = toMinor(refillMajor.value);
  if (thresholdMinor === null || topupAmountMinor === null) return;
  saving.value = true;
  try {
    const lastAttempt = state.value.lastAttempt;
    const updated = await api.put<Omit<AutoTopupState, 'lastAttempt'>>('/api/wallet/auto-topup', {
      enabled: true, thresholdMinor, topupAmountMinor, consentAccepted: true
    });
    state.value = { ...updated, lastAttempt };
    editing.value = false;
    consentAccepted.value = false;
    toast.ok('Automatic top-up enabled');
  } catch (error: any) { toast.err(error.message); }
  finally { saving.value = false; }
}

async function disable() {
  saving.value = true;
  try {
    const lastAttempt = state.value?.lastAttempt ?? null;
    const updated = await api.delete<Omit<AutoTopupState, 'lastAttempt'>>('/api/wallet/auto-topup');
    state.value = { ...updated, lastAttempt };
    editing.value = false;
    toast.ok('Automatic top-up turned off');
  } catch (error: any) { toast.err(error.message); }
  finally { saving.value = false; }
}

onMounted(load);
watch(() => props.refreshKey, (next, previous) => { if (next !== previous) load(); });
</script>

<style scoped>
.atp-card { margin-bottom: 32px; overflow: hidden; }
.atp-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; padding: 18px 24px; border-bottom: 1px solid var(--rule-2); }
.atp-title { font-size: 17px; font-weight: 600; letter-spacing: -0.01em; }
.atp-sub { margin: 4px 0 0; color: var(--ink-soft); font-size: 13px; line-height: 1.45; }
.atp-status { flex: none; padding: 3px 9px; border-radius: 999px; background: var(--paper-2); color: var(--ink-mute); font-size: 11.5px; font-weight: 600; }
.atp-status.on { color: #1c7a49; background: rgba(34,139,84,.12); }
.atp-body { padding: 20px 24px; }
.atp-loading { padding: 24px; display: flex; flex-direction: column; gap: 10px; }
.atp-skel-wide { width: min(460px, 90%); height: 18px; }
.atp-skel-short { width: 180px; height: 34px; }
.atp-summary, .atp-message { margin: 0; color: var(--ink-soft); font-size: 14px; line-height: 1.6; }
.atp-summary strong { color: var(--ink); font-weight: 600; }
.atp-warning { margin: 12px 0 0; padding: 10px 12px; border-radius: var(--radius-sm); background: rgba(183,121,31,.09); color: #8a5a18; font-size: 12.5px; }
.atp-fields { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.atp-fields .field { margin-bottom: 8px; }
.atp-money-input { position: relative; }
.atp-money-input > span { position: absolute; left: 14px; top: 50%; transform: translateY(-50%); color: var(--ink-mute); font-size: 14px; pointer-events: none; }
.atp-money-input .input { padding-left: 32px; }
.atp-limit { margin: 2px 0 8px; color: var(--ink-mute); font-size: 12px; }
.atp-method { display: flex; justify-content: space-between; gap: 20px; margin-top: 16px; padding: 11px 14px; border: 1px solid var(--rule-2); border-radius: var(--radius-sm); font-size: 13px; }
.atp-method-label { color: var(--ink-soft); }
.atp-consent { display: flex; align-items: flex-start; gap: 10px; margin-top: 16px; color: var(--ink-soft); font-size: 12.5px; line-height: 1.5; cursor: pointer; }
.atp-consent input { width: 16px; height: 16px; margin-top: 2px; flex: none; accent-color: var(--signal); }
.atp-actions { display: flex; align-items: center; gap: 9px; margin-top: 18px; flex-wrap: wrap; }
.atp-attempt { display: flex; align-items: flex-start; gap: 9px; margin-top: 14px; color: var(--ink-soft); font-size: 12.5px; line-height: 1.45; }
.atp-attempt-dot { width: 7px; height: 7px; margin-top: 5px; flex: none; border-radius: 50%; background: var(--ink-mute); }
.atp-attempt.is-succeeded .atp-attempt-dot { background: #1c7a49; }
.atp-attempt.is-failed .atp-attempt-dot, .atp-attempt.is-needs_review .atp-attempt-dot { background: var(--danger); }
.atp-attempt.is-uncertain .atp-attempt-dot { background: #b7791f; }
.atp-owner-note { margin: 14px 0 0; color: var(--ink-mute); font-size: 12.5px; }
@media (max-width: 640px) {
  .atp-head, .atp-body { padding-left: 18px; padding-right: 18px; }
  .atp-fields { grid-template-columns: 1fr; gap: 4px; }
}
</style>
