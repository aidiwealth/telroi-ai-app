<template>
  <Teleport to="body">
    <div v-if="open" class="gl-overlay">
      <div class="gl-card" role="dialog" aria-modal="true" aria-labelledby="gl-title">
        <p class="gl-eyebrow">Verification complete</p>
        <h2 id="gl-title" class="gl-title">{{ workspaceName }} is ready to go live</h2>
        <p class="gl-lede">
          Choose the plan you'll be billed on. Until you do, everything stays in sandbox
          and nothing is charged.
        </p>

        <div class="gl-changes">
          <div class="gl-change"><span class="gl-dot" /> Calls reach real numbers, not test lines</div>
          <div class="gl-change"><span class="gl-dot" /> Numbers and channels bill monthly</div>
          <div class="gl-change"><span class="gl-dot" /> Calls and AI are charged as you use them</div>
        </div>

        <div class="gl-plans">
          <button
            v-for="p in plans" :key="p.key"
            class="gl-plan" :class="{ 'is-picked': picked === p.key }"
            type="button" @click="picked = p.key"
          >
            <span v-if="p.key === 'growth'" class="gl-tag">Recommended</span>
            <span class="gl-plan-name">{{ p.name }}</span>
            <span class="gl-plan-price">{{ money(p.monthly) }}<span class="gl-plan-per">/month</span></span>
            <span class="gl-plan-note">{{ p.note }}</span>
          </button>
        </div>

        <p v-if="usage" class="gl-usage">
          Plus usage: {{ money(usage.voiceMinute) }} a minute for calls,
          {{ money(usage.didMonthly) }} per number and {{ money(usage.channelMonthly) }}
          per channel each month. AI is charged by what it transcribes and speaks.
        </p>

        <p v-if="error" class="gl-error">{{ error }}</p>

        <div class="gl-actions">
          <button class="btn btn-signal gl-go" :disabled="busy" @click="goLive">
            {{ busy ? 'Setting up…' : `Go live on ${pickedName}` }}
          </button>
          <button class="gl-later" :disabled="busy" @click="open = false">Not yet — stay in sandbox</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useAuthStore } from '~/stores/auth';

const auth = useAuthStore();
const open = ref(false);
const busy = ref(false);
const error = ref('');
const picked = ref<'startup' | 'growth'>('growth');
const pricing = ref<any>(null);

const workspaceName = computed(() => auth.tenant?.name || 'Your workspace');
const usage = computed(() => pricing.value?.usage || null);
const currency = computed(() => pricing.value?.currency || 'USD');

// Prices are stored in minor units — cents, or kobo once converted.
function money(minor?: number) {
  if (minor == null) return '—';
  const major = minor / 100;
  const sym = currency.value === 'NGN' ? '₦' : '$';
  return sym + major.toLocaleString(undefined, {
    minimumFractionDigits: major < 1 ? 2 : 0,
    maximumFractionDigits: 2
  });
}

const plans = computed(() => [
  { key: 'startup' as const, name: 'Startup', monthly: pricing.value?.plans?.startup, note: 'For a single line and a small team.' },
  { key: 'growth' as const, name: 'Growth', monthly: pricing.value?.plans?.growth, note: 'More numbers, more agents, full AI.' }
]);
const pickedName = computed(() => (picked.value === 'growth' ? 'Growth' : 'Startup'));

async function goLive() {
  busy.value = true; error.value = '';
  try {
    await $fetch('/api/go-live', { method: 'POST', body: { plan: picked.value } });
    // Tell the rest of the app straight away. The toggle used to keep showing
    // sandbox until something else reloaded, which made a decision the client had
    // just made look as though it hadn't taken.
    if (auth.tenant) auth.tenant.sandbox = false;
    if (import.meta.client) {
      localStorage.setItem('telroi_env', 'live');
      window.dispatchEvent(new CustomEvent('telroi-env-change', { detail: 'live' }));
    }
    open.value = false;
  } catch (e: any) {
    error.value = e?.data?.error?.message || 'Could not complete this. Please try again.';
  } finally {
    busy.value = false;
  }
}

onMounted(async () => {
  try {
    const r = await $fetch<any>('/api/go-live');
    pricing.value = r?.pricing || null;
    // The server already decides who this is for — approved and not yet live.
    // Reading its flag rather than re-deriving it keeps the two from drifting.
    // It returns on the next visit if they'd rather decide later.
    open.value = !!r?.eligible;
  } catch { /* nothing to prompt about */ }
});
</script>

<style scoped>
.gl-overlay { position: fixed; inset: 0; z-index: 300; background: rgba(10,10,11,.5); backdrop-filter: blur(3px); display: flex; align-items: center; justify-content: center; padding: 24px; }
.gl-card { width: 100%; max-width: 520px; background: var(--paper); border: 1px solid var(--rule); border-radius: var(--radius-lg); padding: 32px; box-shadow: 0 24px 60px rgba(10,10,11,.22); }

.gl-eyebrow { font-size: 11.5px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: var(--signal); margin: 0 0 10px; }
.gl-title { font-size: 24px; font-weight: 600; color: var(--ink); margin: 0 0 10px; line-height: 1.25; letter-spacing: -.01em; }
.gl-lede { font-size: 14.5px; color: var(--ink-soft); line-height: 1.6; margin: 0 0 22px; }

.gl-changes { border-top: 1px solid var(--rule); border-bottom: 1px solid var(--rule); padding: 16px 0; margin-bottom: 22px; display: flex; flex-direction: column; gap: 9px; }
.gl-change { display: flex; align-items: center; gap: 10px; font-size: 13.5px; color: var(--ink); }
.gl-dot { width: 5px; height: 5px; border-radius: 50%; background: var(--signal); flex: none; }

.gl-plans { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 16px; }
.gl-plan { position: relative; text-align: left; display: flex; flex-direction: column; gap: 4px; padding: 16px; border: 1px solid var(--rule); border-radius: var(--radius); background: var(--paper); cursor: pointer; transition: border-color .15s, background .15s; }
.gl-plan:hover { border-color: var(--ink-soft); }
.gl-plan.is-picked { border-color: var(--signal); background: var(--paper-2); box-shadow: inset 0 0 0 1px var(--signal); }
.gl-tag { position: absolute; top: -8px; right: 12px; font-size: 10px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; background: var(--signal); color: #fff; padding: 3px 7px; border-radius: 999px; }
.gl-plan-name { font-size: 13px; font-weight: 600; color: var(--ink); }
.gl-plan-price { font-size: 22px; font-weight: 600; color: var(--ink); letter-spacing: -.02em; }
.gl-plan-per { font-size: 12.5px; font-weight: 400; color: var(--ink-soft); margin-left: 2px; }
.gl-plan-note { font-size: 12px; color: var(--ink-soft); line-height: 1.45; }

.gl-usage { font-size: 12px; color: var(--ink-soft); line-height: 1.6; margin: 0 0 20px; }
.gl-error { font-size: 13px; color: var(--danger); margin: 0 0 14px; }

.gl-actions { display: flex; flex-direction: column; gap: 10px; align-items: center; }
.gl-go { width: 100%; padding: 12px; font-size: 14.5px; font-weight: 600; border-radius: var(--radius); }
.gl-later { background: none; border: 0; color: var(--ink-soft); font-size: 13px; cursor: pointer; padding: 4px; }
.gl-later:hover { color: var(--ink); }

@media (max-width: 480px) {
  .gl-card { padding: 24px; }
  .gl-plans { grid-template-columns: 1fr; }
}
</style>
