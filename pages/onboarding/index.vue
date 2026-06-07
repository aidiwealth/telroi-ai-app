<template>
  <div class="wizard">
    <!-- Progress -->
    <div class="wz-progress">
      <div v-for="(s, i) in steps" :key="i" class="wz-dot" :class="{ done: i < step, active: i === step }">
        <span class="wz-dot-num">{{ i < step ? '✓' : i + 1 }}</span>
        <span class="wz-dot-label">{{ s }}</span>
      </div>
    </div>

    <div class="wizard-card card">
      <!-- STEP 0: Company -->
      <section v-if="step === 0">
        <div class="kicker">Step 1 of 6</div>
        <h1>Name your <em>workspace</em></h1>
        <p class="wz-lede">This is your company's home on Telroi.</p>

        <div class="field">
          <label>Company name</label>
          <input v-model="company" class="input" placeholder="Acme Corp" @input="onCompanyInput" autofocus />
          <span class="hint" :class="{ bad: slugState === 'taken' || slugState === 'invalid' }">
            {{ slugState === 'taken' ? 'A workspace with a similar name exists — we\'ll adjust yours automatically.' : 'Your team will sign in with their email.' }}
          </span>
        </div>
        <div class="field">
          <label>Time zone</label>
          <select v-model="timezone" class="select">
            <option v-for="tz in timezones" :key="tz" :value="tz">{{ tz }}</option>
          </select>
        </div>
        <div class="field-row">
          <div class="field">
            <label>Country</label>
            <select v-model="country" class="select">
              <option value="" disabled>Select country</option>
              <option v-for="c in countries" :key="c" :value="c">{{ c }}</option>
            </select>
          </div>
          <div class="field">
            <label>Sector</label>
            <select v-model="sector" class="select">
              <option value="" disabled>Select sector</option>
              <option v-for="sct in sectors" :key="sct" :value="sct">{{ sct }}</option>
            </select>
          </div>
        </div>

        <div class="field">
          <label>Business phone</label>
          <input v-model="businessPhone" class="input mono" placeholder="+234 800 000 0000" inputmode="tel" />
          <span class="hint">Your main contact number — we use this to reach you and link your calls.</span>
        </div>

        <label class="policy-consent" @click.prevent="onConsentClick">
          <input type="checkbox" :checked="acceptPolicy" @click.prevent />
          <span>I have read and agree to Telroi's <button type="button" class="policy-link" @click.stop.prevent="openPolicy">Terms of Service, Privacy &amp; Data Protection Policy</button>.</span>
        </label>

        <button class="btn btn-signal" :disabled="!canCreate || !acceptPolicy || busy" @click="createWorkspace">
          {{ busy ? 'Creating…' : 'Create workspace' }} <span class="arrow">→</span>
        </button>
      </section>

      <!-- Policy reader modal — must scroll to the bottom before agreeing -->
      <div v-if="showPolicy" class="policy-overlay" @click.self="showPolicy = false">
        <div class="policy-modal">
          <div class="policy-modal-head">
            <div>
              <h3>{{ policy?.title || 'Telroi Policy' }}</h3>
              <span class="policy-ver" v-if="policy">Version {{ policy.version }}</span>
            </div>
            <button class="policy-x" @click="showPolicy = false">✕</button>
          </div>
          <div class="policy-body" ref="policyBodyEl" @scroll="onPolicyScroll">
            <div v-if="!policy" class="muted">Loading…</div>
            <template v-else>
              <section v-for="(s, i) in policy.sections" :key="i" class="policy-sec">
                <h4>{{ s.heading }}</h4>
                <p v-for="(p, j) in s.body" :key="j">{{ p }}</p>
              </section>
            </template>
          </div>
          <div class="policy-modal-foot">
            <span v-if="!scrolledToEnd" class="policy-scroll-hint">Scroll to the end to continue ↓</span>
            <button class="btn btn-ghost btn-sm" @click="showPolicy = false">Close</button>
            <button class="btn btn-signal btn-sm" :disabled="!scrolledToEnd" @click="agreePolicy">I have read and agree</button>
          </div>
        </div>
      </div>

      <!-- STEP 1: Plan -->
      <section v-else-if="step === 1">
        <div class="kicker">Step 2 of 6</div>
        <h1>Choose your <em>plan</em></h1>
        <p class="wz-lede">Both plans start with a {{ trialDays }}-day free trial. You won't be charged until it ends, and you can change plans anytime in Settings.</p>

        <div class="plan-grid">
          <button class="plan-card" :class="{ sel: plan === 'startup' }" @click="plan = 'startup'">
            <div class="plan-flag light">{{ trialDays }}-day free trial</div>
            <div class="plan-name">Startup</div>
            <div class="plan-price"><span class="plan-cur">$</span>10<span class="plan-per">/user/mo</span></div>
            <p class="plan-desc">Core voice infrastructure: AI numbers, recording, routing, API, fraud scoring.</p>
          </button>
          <button class="plan-card featured" :class="{ sel: plan === 'growth' }" @click="plan = 'growth'">
            <div class="plan-flag">{{ trialDays }}-day free trial</div>
            <div class="plan-name">Growth</div>
            <div class="plan-price"><span class="plan-cur">$</span>15<span class="plan-per">/user/mo</span></div>
            <p class="plan-desc">Everything in Startup plus the Telroi One suite: CRM, dialer, messenger, your subdomain, AI summaries, admin controls.</p>
          </button>
        </div>
        <p class="plan-trial-note">Your {{ trialDays }}-day {{ plan === 'growth' ? 'Growth' : 'Startup' }} trial starts now. We'll collect a card next and charge <strong>$0 until the trial ends</strong>; after that, your plan renews unless you cancel.</p>

        <div class="wz-actions">
          <button class="btn btn-ghost" @click="back">Back</button>
          <button class="btn btn-signal" :disabled="busy" @click="selectPlan">
            {{ busy ? 'Saving…' : `Start ${trialDays}-day trial` }} <span class="arrow">→</span>
          </button>
        </div>
      </section>

      <!-- STEP 2: Card on file ($0 during trial) -->
      <section v-else-if="step === 2">
        <div class="kicker">Step 3 of 6</div>
        <h1>Add a <em>card</em></h1>
        <p class="wz-lede">We need a card on file to start your trial. <strong>You'll be charged $0 until your {{ trialDays }}-day trial ends</strong> — then your plan renews automatically unless you cancel.</p>

        <div v-if="savedCard" class="card-saved">
          <span class="card-saved-icon">💳</span>
          <div>
            <div class="card-saved-line">{{ (savedCard.brand || 'Card') }} ending {{ savedCard.last4 || '••••' }}</div>
            <div class="card-saved-sub muted">Saved · $0 charged during your trial</div>
          </div>
        </div>

        <div v-else class="card-form">
          <!-- PLACEHOLDER tokenizer. Replace this block with the provider's secure
               element (Stripe Elements / Paystack inline). Raw card numbers must
               NEVER hit our server — the SDK returns a token we save. -->
          <div class="card-secure-note">🔒 Card details are handled by our payment provider. Telroi never sees your full card number.</div>
          <div class="field">
            <label>Cardholder name</label>
            <input v-model="cardName" class="input" placeholder="Name on card" />
          </div>
          <p class="card-dev-note muted">Payment provider element mounts here once keys are configured. For now, use the demo button to simulate saving a tokenized card.</p>
        </div>

        <div class="wz-actions">
          <button class="btn btn-ghost" @click="back">Back</button>
          <button v-if="!savedCard" class="btn btn-signal" :disabled="busy || !cardName" @click="saveCard">
            {{ busy ? 'Saving…' : 'Save card & continue' }} <span class="arrow">→</span>
          </button>
          <button v-else class="btn btn-signal" @click="next">Continue <span class="arrow">→</span></button>
        </div>
      </section>

      <!-- STEP 3: AI -->
      <section v-else-if="step === 3">
        <div class="kicker">Step 4 of 6</div>
        <h1>Connect <em>AI</em> <span class="opt">(optional)</span></h1>
        <p class="wz-lede">Bring your own keys for the AI providers you use. <strong>Telroi never charges you for model usage</strong> — you're billed directly by each provider.</p>

        <div class="ai-rows">
          <div v-for="p in aiProviders" :key="p.id" class="ai-row">
            <span class="ai-name">{{ p.label }}</span>
            <input v-model="aiKeys[p.id]" class="input mono ai-input" type="password" :placeholder="`${p.label} API key`" />
          </div>
        </div>

        <div class="wz-actions">
          <button class="btn btn-ghost" @click="back">Back</button>
          <div class="wz-actions-right">
            <button class="btn btn-ghost" @click="next">Skip</button>
            <button class="btn btn-signal" :disabled="busy" @click="saveAi">
              {{ busy ? 'Saving…' : 'Save & continue' }} <span class="arrow">→</span>
            </button>
          </div>
        </div>
      </section>

      <!-- STEP 4: Team -->
      <section v-else-if="step === 4">
        <div class="kicker">Step 5 of 6</div>
        <h1>Invite your <em>team</em> <span class="opt">(optional)</span></h1>
        <p class="wz-lede">Add the people who'll answer calls. We'll email them an invite.</p>

        <div v-for="(inv, i) in invites" :key="i" class="invite-row">
          <input v-model="inv.email" class="input" type="email" placeholder="teammate@company.com" />
          <button v-if="invites.length > 1" class="btn btn-ghost btn-sm" @click="invites.splice(i, 1)">Remove</button>
        </div>
        <button class="link-add" @click="invites.push({ email: '' })">+ Add another</button>

        <div class="wz-actions">
          <button class="btn btn-ghost" @click="back">Back</button>
          <div class="wz-actions-right">
            <button class="btn btn-ghost" @click="next">I'll do this later</button>
            <button class="btn btn-signal" @click="next">Continue <span class="arrow">→</span></button>
          </div>
        </div>
      </section>

      <!-- STEP 5: Purchase a number (skips automatically if no inventory) -->
      <section v-else-if="step === 5">
        <div class="kicker">Step 6 of 6</div>
        <h1>Get your first <em>number</em> <span class="opt">(optional)</span></h1>

        <div v-if="numbersLoading" class="muted wz-loading">Checking available numbers…</div>

        <template v-else-if="availableNumbers.length">
          <p class="wz-lede">Choose a number to activate now. The first month ({{ moneyFmt(numberCost) }}) covers the line and one channel.</p>
          <div class="num-list">
            <label v-for="n in availableNumbers" :key="n.id" class="num-opt" :class="{ sel: pickedNumber === n.id }">
              <input type="radio" :value="n.id" v-model="pickedNumber" />
              <span class="num-tel mono">{{ n.telnum }}</span>
              <span class="num-region">{{ n.region }}</span>
            </label>
          </div>

          <label class="num-charge">
            <input type="checkbox" v-model="chargeCardForNumber" />
            <span>Charge my saved card {{ moneyFmt(numberCost) }} now — we'll add it to your wallet and pay for the number from there, so you have a clean record.</span>
          </label>

          <div class="wz-actions">
            <button class="btn btn-ghost" @click="back">Back</button>
            <div class="wz-actions-right">
              <button class="btn btn-ghost" :disabled="busy" @click="finish">Skip for now</button>
              <button class="btn btn-signal" :disabled="busy || !pickedNumber" @click="buyNumberThenFinish">
                {{ busy ? 'Processing…' : 'Activate number' }} <span class="arrow">→</span>
              </button>
            </div>
          </div>
        </template>

        <template v-else>
          <p class="wz-lede">No numbers are available to purchase right now. You can add one anytime from the Numbers page once your operator provisions inventory.</p>
          <div class="wz-actions">
            <button class="btn btn-ghost" @click="back">Back</button>
            <button class="btn btn-signal" :disabled="busy" @click="finish">
              {{ busy ? 'Finishing…' : 'Go to dashboard' }} <span class="arrow">→</span>
            </button>
          </div>
        </template>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue';
import { useAuthStore } from '~/stores/auth';

definePageMeta({ layout: 'bare' });
useHead({ title: 'Set up your workspace — Telroi' });

const api = useApi();
const toast = useToast();
const auth = useAuthStore();
const rootDomain = useRuntimeConfig().public.rootDomain;

const steps = ['Company', 'Plan', 'Card', 'AI', 'Team', 'Number'];
const step = ref(0);

// step 1 (plan)
const plan = ref<'startup' | 'growth'>('growth');
const trialDays = ref(7);

// step 2 (card)
const cardName = ref('');
const savedCard = ref<any>(null);

// step 5 (number purchase)
const numbersLoading = ref(false);
const availableNumbers = ref<any[]>([]);
const pickedNumber = ref('');
const chargeCardForNumber = ref(true);
const numberCost = ref(0);
const numberCurrency = ref<'USD' | 'NGN'>('USD');

// step 0
const company = ref('');
const slug = ref('');
const timezone = ref('UTC');
const country = ref('');
const sector = ref('');
const businessPhone = ref('');
const acceptPolicy = ref(false);
const showPolicy = ref(false);
const policy = ref<any>(null);
const policyBodyEl = ref<HTMLElement | null>(null);
const scrolledToEnd = ref(false);

// Open the reader (from the checkbox or the link). If already accepted, the
// checkbox toggles off; otherwise it must be earned via the modal.
function onConsentClick() {
  if (acceptPolicy.value) { acceptPolicy.value = false; return; }
  openPolicy();
}
function openPolicy() {
  scrolledToEnd.value = false;
  showPolicy.value = true;
}
function onPolicyScroll(e: Event) {
  const el = e.target as HTMLElement;
  if (el.scrollTop + el.clientHeight >= el.scrollHeight - 24) scrolledToEnd.value = true;
}
function agreePolicy() {
  acceptPolicy.value = true;
  showPolicy.value = false;
}

// Load the policy text the first time the reader is opened. If the content is
// short enough that there's nothing to scroll, enable the agree button.
watch(showPolicy, async (open) => {
  if (!open) return;
  if (!policy.value) { try { policy.value = await api.get('/api/policy'); } catch { /* */ } }
  await nextTick();
  const el = policyBodyEl.value;
  if (el && el.scrollHeight <= el.clientHeight + 24) scrolledToEnd.value = true;
});
const slugState = ref<'idle' | 'checking' | 'available' | 'taken' | 'invalid'>('idle');
const timezones = ['UTC', 'Europe/London', 'Europe/Berlin', 'Africa/Lagos', 'America/New_York', 'America/Los_Angeles', 'Asia/Dubai'];
const countries = ['Nigeria', 'Ghana', 'Kenya', 'South Africa', 'United States', 'Canada', 'United Kingdom', 'Germany', 'France', 'United Arab Emirates', 'India', 'Other'];
const sectors = ['Financial services', 'E-commerce & retail', 'Healthcare', 'Technology / SaaS', 'Telecommunications', 'Logistics & delivery', 'Education', 'Real estate', 'Hospitality & travel', 'Government', 'Media & entertainment', 'Professional services', 'Other'];

// step 1
const aiProviders = [
  { id: 'openai', label: 'OpenAI' }, { id: 'anthropic', label: 'Anthropic (Claude)' },
  { id: 'deepgram', label: 'Deepgram' }, { id: 'elevenlabs', label: 'ElevenLabs' },
  { id: 'vapi', label: 'VAPI' }, { id: 'google', label: 'Google' }
];
const aiKeys = ref<Record<string, string>>({});

// step 2
const invites = ref<{ email: string }[]>([{ email: '' }]);

// step 3
const route = ref('user');

const busy = ref(false);

const slugHint = computed(() => {
  switch (slugState.value) {
    case 'checking': return 'Checking availability…';
    case 'available': return '✓ Available';
    case 'taken': return 'That subdomain is taken';
    case 'invalid': return 'Use 2–40 lowercase letters, numbers or hyphens';
    default: return 'Your team will sign in here';
  }
});
const canCreate = computed(() => !!company.value && !!country.value && !!sector.value && slugState.value !== 'checking');

// Always regenerate the (hidden) subdomain from the company name and check it.
function onCompanyInput() {
  // Subdomain = the first word of the company name only (e.g. "Acme Corp Ltd" -> "acme").
  const firstWord = company.value.trim().split(/\s+/)[0] || '';
  slug.value = firstWord.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 40);
  checkSlug();
}
function suggestSlug() { onCompanyInput(); }
let slugTimer: any;
function checkSlug() {
  clearTimeout(slugTimer);
  slug.value = slug.value.toLowerCase();
  if (!/^[a-z0-9-]{2,40}$/.test(slug.value)) { slugState.value = 'invalid'; return; }
  slugState.value = 'checking';
  slugTimer = setTimeout(async () => {
    try {
      const r = await api.get<{ available: boolean }>('/api/tenant/slug-available', { slug: slug.value });
      // If taken, append a short suffix so creation still succeeds silently.
      if (!r.available) { slug.value = `${slug.value}-${Math.floor(Math.random() * 900 + 100)}`.slice(0, 40); slugState.value = 'taken'; }
      else slugState.value = 'available';
    } catch { slugState.value = 'invalid'; }
  }, 350);
}

function back() { step.value = Math.max(0, step.value - 1); }
function next() { step.value = Math.min(5, step.value + 1); }

function moneyFmt(minor: number) {
  const sym = numberCurrency.value === 'NGN' ? '₦' : '$';
  return `${sym}${(minor / 100).toFixed(2)}`;
}

// Load purchasable numbers when the number step is reached.
watch(step, async (st) => {
  if (st === 5 && !availableNumbers.value.length && !numbersLoading.value) {
    numbersLoading.value = true;
    try {
      const r = await api.get<any>('/api/numbers/available');
      availableNumbers.value = r.numbers || r.items || [];
      if (typeof r.firstMonthMinor === 'number') { numberCost.value = r.firstMonthMinor; numberCurrency.value = r.currency || 'USD'; }
    } catch { availableNumbers.value = []; }
    finally { numbersLoading.value = false; }
  }
});

async function createWorkspace() {
  busy.value = true;
  try {
    await api.post('/api/tenant/create', { name: company.value, slug: slug.value, timezone: timezone.value, country: country.value, sector: sector.value, businessPhone: businessPhone.value || undefined, acceptPolicy: acceptPolicy.value });
    await auth.fetchMe();
    // Pick up the admin-configured trial length for this tenant.
    try { const pl = await api.get<{ trialDays: number }>('/api/plan'); trialDays.value = pl.trialDays || 7; } catch { /* */ }
    next();
  } catch (e: any) { toast.err(e.message); }
  finally { busy.value = false; }
}

async function selectPlan() {
  busy.value = true;
  try {
    await api.post('/api/plan/select', { plan: plan.value });
    next();
  } catch (e: any) { toast.err(e.message); }
  finally { busy.value = false; }
}

async function saveCard() {
  busy.value = true;
  try {
    // PLACEHOLDER tokenization. With a real provider, the SDK returns a token
    // and card metadata client-side; we POST only those. This demo token lets
    // the flow proceed end-to-end until provider keys are wired.
    const demoToken = `tok_demo_${Date.now()}`;
    await api.post('/api/payment-method', {
      provider: 'stripe', token: demoToken,
      brand: 'visa', last4: '4242', expMonth: 12, expYear: 2030
    });
    savedCard.value = { brand: 'visa', last4: '4242' };
    toast.ok('Card saved — $0 charged during your trial');
  } catch (e: any) { toast.err(e.message); }
  finally { busy.value = false; }
}

async function saveAi() {
  busy.value = true;
  try {
    for (const [provider, key] of Object.entries(aiKeys.value)) {
      if (key && key.trim().length > 7) {
        await api.post('/api/ai/connections', { provider, apiKey: key.trim() });
      }
    }
    toast.ok('AI keys saved securely');
    next();
  } catch (e: any) { toast.err(e.message); }
  finally { busy.value = false; }
}

async function buyNumberThenFinish() {
  if (!pickedNumber.value) return;
  busy.value = true;
  try {
    await api.post('/api/numbers/purchase', { inventoryId: pickedNumber.value, channels: 1, chargeCard: chargeCardForNumber.value });
    toast.ok('Number activated 🎉');
    await finish();
  } catch (e: any) {
    toast.err(e.message);
    busy.value = false; // let them retry / skip
  }
}

async function finish() {
  busy.value = true;
  try {
    await api.patch('/api/tenant', { onboardingStep: 5 });
    await auth.fetchMe();
    // Ensure the setup to-do opens by default on the new dashboard (until the
    // user chooses to collapse it).
    try { localStorage.removeItem('telroi_setup_tasks_collapsed'); } catch { /* */ }
    toast.ok("You're live 🎉");
    await navigateTo('/');
  } catch (e: any) { toast.err(e.message); }
  finally { busy.value = false; }
}
</script>

<style scoped>
.wizard { width: 100%; max-width: 560px; }
.field-row { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.field-row .field { margin-bottom: 0; }
.policy-consent { display: flex; align-items: flex-start; gap: 9px; margin: 18px 0 20px; font-size: 13px; color: var(--ink-soft); line-height: 1.5; cursor: pointer; }
.policy-consent input { margin-top: 2px; width: 16px; height: 16px; accent-color: var(--signal); flex-shrink: 0; cursor: pointer; }
.policy-link { color: var(--signal); text-decoration: underline; text-underline-offset: 2px; font-size: 13px; }
.policy-overlay { position: fixed; inset: 0; z-index: 300; background: rgba(10,10,11,0.4); display: flex; align-items: center; justify-content: center; padding: 24px; }
.policy-modal { width: 100%; max-width: 640px; max-height: 86vh; background: var(--paper); border-radius: var(--radius-lg); display: flex; flex-direction: column; overflow: hidden; }
.policy-modal-head { display: flex; align-items: flex-start; justify-content: space-between; padding: 22px 26px; border-bottom: 1px solid var(--rule); }
.policy-modal-head h3 { font-family: var(--font-display); font-size: 19px; color: var(--ink); }
.policy-ver { font-size: 11.5px; color: var(--ink-mute); font-family: var(--font-mono); }
.policy-x { color: var(--ink-mute); font-size: 16px; }
.policy-body { overflow-y: auto; padding: 8px 26px 20px; }
.policy-sec { margin-top: 16px; }
.policy-sec h4 { font-size: 14px; color: var(--ink); margin-bottom: 6px; }
.policy-sec p { font-size: 13px; color: var(--ink-soft); line-height: 1.6; margin: 0 0 8px; }
.policy-modal-foot { display: flex; justify-content: flex-end; gap: 10px; align-items: center; padding: 16px 26px; border-top: 1px solid var(--rule); }
.policy-scroll-hint { font-size: 12px; color: var(--warn); margin-right: auto; }
.plan-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin: 8px 0 6px; }
.plan-card { text-align: left; padding: 20px; border: 1px solid var(--rule); border-radius: var(--radius-lg); background: var(--paper); position: relative; transition: border-color 0.15s, box-shadow 0.15s; }
.plan-card:hover { border-color: var(--signal-bright); }
.plan-card.sel { border-color: var(--signal); box-shadow: 0 0 0 3px var(--signal-soft); }
.plan-flag { position: absolute; top: 14px; right: 14px; font-size: 10px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: var(--signal); background: var(--signal-soft); padding: 3px 8px; border-radius: 999px; }
.plan-name { font-family: var(--font-display); font-size: 18px; color: var(--ink); margin-bottom: 6px; }
.plan-price { font-size: 26px; font-weight: 600; color: var(--ink); letter-spacing: -0.01em; }
.plan-cur { font-size: 16px; vertical-align: super; margin-right: 1px; }
.plan-per { font-size: 12px; font-weight: 400; color: var(--ink-mute); margin-left: 2px; }
.plan-desc { font-size: 12.5px; color: var(--ink-soft); line-height: 1.5; margin-top: 10px; }
.plan-trial-note { font-size: 12.5px; color: var(--signal-2); background: var(--signal-soft); border-radius: var(--radius); padding: 10px 14px; margin: 4px 0 0; line-height: 1.5; }
.plan-flag.light { background: var(--paper-3); color: var(--ink-soft); }
.card-saved { display: flex; align-items: center; gap: 14px; padding: 16px 18px; border: 1px solid var(--signal); background: var(--signal-soft); border-radius: var(--radius-lg); margin: 8px 0; }
.card-saved-icon { font-size: 22px; }
.card-saved-line { font-size: 14px; font-weight: 600; color: var(--ink); }
.card-saved-sub { font-size: 12.5px; margin-top: 2px; }
.card-form { margin: 8px 0; }
.card-secure-note { font-size: 12.5px; color: var(--ink-soft); background: var(--paper-2); border-radius: var(--radius); padding: 10px 14px; margin-bottom: 14px; }
.card-dev-note { font-size: 12px; margin-top: 8px; line-height: 1.5; }
.wz-loading { padding: 24px 0; }
.num-list { display: flex; flex-direction: column; gap: 8px; margin: 6px 0 16px; }
.num-opt { display: flex; align-items: center; gap: 12px; padding: 12px 14px; border: 1px solid var(--rule); border-radius: var(--radius); cursor: pointer; transition: border-color 0.14s, background 0.14s; }
.num-opt:hover { border-color: var(--signal-bright); }
.num-opt.sel { border-color: var(--signal); background: var(--signal-soft); }
.num-tel { font-size: 15px; color: var(--ink); flex: 1; }
.num-region { font-size: 12px; color: var(--ink-mute); text-transform: uppercase; letter-spacing: 0.04em; }
.num-charge { display: flex; align-items: flex-start; gap: 9px; font-size: 13px; color: var(--ink-soft); line-height: 1.5; margin-bottom: 18px; cursor: pointer; }
.num-charge input { margin-top: 2px; width: 16px; height: 16px; accent-color: var(--signal); flex-shrink: 0; }
.wz-progress { display: flex; justify-content: space-between; margin-bottom: 24px; padding: 0 4px; }
.wz-dot { display: flex; flex-direction: column; align-items: center; gap: 6px; flex: 1; position: relative; }
.wz-dot:not(:last-child)::after {
  content: ''; position: absolute; top: 13px; left: 60%; right: -40%; height: 1px; background: var(--rule);
}
.wz-dot.done:not(:last-child)::after { background: var(--signal); }
.wz-dot-num {
  width: 26px; height: 26px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
  font-size: 12px; font-weight: 600; background: var(--paper); border: 1px solid var(--rule); color: var(--ink-mute); z-index: 1;
}
.wz-dot.active .wz-dot-num { border-color: var(--signal); color: var(--signal); }
.wz-dot.done .wz-dot-num { background: var(--signal); border-color: var(--signal); color: #fff; }
.wz-dot-label { font-size: 11px; color: var(--ink-mute); }
.wz-dot.active .wz-dot-label { color: var(--ink); }

.wizard-card { padding: 36px; }
.wizard-card h1 { font-size: 28px; margin-bottom: 10px; }
.wizard-card .opt { font-size: 15px; color: var(--ink-mute); font-family: var(--font-sans); }
.wz-lede { color: var(--ink-soft); font-size: 14.5px; line-height: 1.55; margin-bottom: 26px; }
.wz-lede strong { color: var(--signal); font-weight: 500; }

.slug-row { display: flex; align-items: center; gap: 0; }
.slug-row .input { border-top-right-radius: 0; border-bottom-right-radius: 0; }
.slug-suffix { padding: 11px 14px; background: var(--paper-2); border: 1px solid var(--rule); border-left: 0; border-radius: 0 var(--radius) var(--radius) 0; color: var(--ink-soft); font-size: 14px; }
.hint.ok { color: #0a8a5c; }
.hint.bad { color: var(--danger); }

.choice-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 20px; }
.choice { text-align: left; padding: 20px; border: 1px solid var(--rule); border-radius: var(--radius-lg); background: var(--paper); position: relative; transition: border-color 0.15s, box-shadow 0.15s; }
.choice:hover { border-color: var(--signal-bright); }
.choice.sel { border-color: var(--signal); box-shadow: 0 0 0 3px var(--signal-soft); }
.choice h3 { font-size: 17px; margin-bottom: 6px; }
.choice p { font-size: 13px; color: var(--ink-soft); line-height: 1.5; }
.choice-badge { position: absolute; top: 14px; right: 14px; font-size: 10px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--signal); background: var(--signal-soft); padding: 3px 8px; border-radius: 999px; }
.provision-box { background: var(--paper-2); border: 1px solid var(--rule-2); border-radius: var(--radius); padding: 18px 18px 2px; margin-bottom: 8px; }
.prov-note { font-size: 12.5px; margin-bottom: 14px; }

.ai-rows { display: flex; flex-direction: column; gap: 12px; margin-bottom: 24px; }
.ai-row { display: grid; grid-template-columns: 150px 1fr; align-items: center; gap: 14px; }
.ai-name { font-size: 13.5px; font-weight: 500; }
.ai-input { font-size: 13px; }

.invite-row { display: flex; gap: 10px; margin-bottom: 10px; }
.invite-row .input { flex: 1; }
.link-add { font-size: 13px; color: var(--signal); margin-bottom: 8px; }

.route-opts { display: flex; flex-direction: column; gap: 10px; margin-bottom: 24px; }
.route-opt { display: flex; align-items: center; gap: 10px; padding: 14px 16px; border: 1px solid var(--rule); border-radius: var(--radius); font-size: 14px; cursor: pointer; transition: border-color 0.15s; }
.route-opt.sel { border-color: var(--signal); background: var(--signal-soft); }

.wz-actions { display: flex; justify-content: space-between; align-items: center; margin-top: 28px; }
.wz-actions-right { display: flex; gap: 10px; }

@media (max-width: 560px) {
  .choice-grid { grid-template-columns: 1fr; }
  .ai-row { grid-template-columns: 1fr; gap: 6px; }
  .wz-dot-label { display: none; }
}
</style>
