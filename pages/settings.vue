<template>
  <div>
    <div class="page-head">
      <h1 class="page-title">Settings</h1>
      <p class="page-sub">Manage your workspace, telephony domain and integrations.</p>
    </div>

    <div class="settings-layout">
      <nav class="set-nav">
        <button v-for="t in tabs" :key="t.id" class="set-nav-item" :class="{ active: tab === t.id }" @click="tab = t.id">{{ t.label }}</button>
      </nav>

      <div class="set-body">
        <!-- Plan -->
        <div v-if="tab === 'plan'" class="card card-pad">
          <h3 class="set-title">Your plan</h3>
          <p class="muted set-lede">Switch or upgrade anytime. Changes take effect immediately.</p>

          <div v-if="planState" class="plan-current">
            <div>
              <div class="plan-current-name">
                {{ planLabel(planState.plan) }}
                <span v-if="planState.trial" class="plan-trial-chip">Trialing · {{ planState.trial.daysLeft }}d left</span>
              </div>
              <div class="plan-current-sub">{{ planState.plan === 'startup' ? 'Core voice infrastructure' : 'Full Telroi One suite included' }}</div>
            </div>
          </div>

          <div v-if="planState?.trial" class="plan-trial-banner">
            You're on a free {{ planLabel(planState.trial.plan || planState.plan) }} trial — {{ planState.trial.daysLeft }} day{{ planState.trial.daysLeft === 1 ? '' : 's' }} left.
            When it ends you'll move to <strong>{{ planLabel(planState.basePlan) }}</strong> unless you keep {{ planLabel(planState.trial.plan || planState.plan) }}.
            <NuxtLink to="/settings?tab=billing" class="inline-link">Manage billing →</NuxtLink>
          </div>

          <div class="plan-options">
            <div class="plan-opt" :class="{ on: planState && planState.plan === 'startup' }">
              <div class="plan-opt-head"><span class="plan-opt-name">Startup</span><span class="plan-opt-price">$10<small>/user/mo</small></span></div>
              <p class="plan-opt-desc">AI numbers, recording, routing, API, fraud scoring.</p>
              <span v-if="planState && planState.plan === 'startup'" class="plan-opt-current">Current plan</span>
              <span v-else-if="planState && planState.basePlan === 'startup'" class="plan-opt-after">After trial · </span>
              <button v-if="!planState || planState.plan !== 'startup'" class="btn btn-ghost btn-sm btn-block" :disabled="switching" @click="switchPlan('startup')">Switch to Startup</button>
            </div>
            <div class="plan-opt featured" :class="{ on: planState && planState.plan === 'growth' }">
              <div class="plan-opt-head"><span class="plan-opt-name">Growth</span><span class="plan-opt-price">$15<small>/user/mo</small></span></div>
              <p class="plan-opt-desc">Everything in Startup plus CRM, dialer, messenger, AI summaries, admin controls.</p>
              <span v-if="planState && planState.plan === 'growth' && !planState.trial" class="plan-opt-current">Current plan</span>
              <button v-else-if="!planState || planState.plan !== 'growth'" class="btn btn-signal btn-sm btn-block" :disabled="switching" @click="switchPlan('growth')">Upgrade to Growth</button>
              <button v-else class="btn btn-signal btn-sm btn-block" :disabled="switching" @click="switchPlan('growth')">Keep Growth after trial</button>
            </div>
          </div>
        </div>

        <!-- Billing -->
        <div v-else-if="tab === 'billing'" class="card card-pad">
          <h3 class="set-title">Billing</h3>
          <p class="muted set-lede">Your wallet balance and saved payment method.</p>

          <div v-if="billSummary" class="bill-row">
            <div>
              <div class="bill-label">Monthly recurring</div>
              <div class="bill-value money">{{ recurringDisplay }}<span class="muted bill-sub"> / month</span></div>
              <div class="muted bill-mini">
                {{ billSummary.breakdown.numberCount }} number{{ billSummary.breakdown.numberCount === 1 ? '' : 's' }} · {{ billSummary.breakdown.channelCount }} channel{{ billSummary.breakdown.channelCount === 1 ? '' : 's' }}<template v-if="!billSummary.breakdown.planOnTrial && billSummary.breakdown.planMinor"> · plan fee</template><template v-if="billSummary.breakdown.planOnTrial"> · plan free during trial</template>
              </div>
            </div>
            <div v-if="billSummary.nextBillingAt" class="bill-next">
              <div class="bill-label">Next charge</div>
              <div class="bill-value">{{ fmtBillDate(billSummary.nextBillingAt) }}</div>
            </div>
          </div>

          <div class="bill-row">
            <div>
              <div class="bill-label">Wallet balance</div>
              <div class="bill-value money">{{ walletDisplay }}</div>
            </div>
            <NuxtLink to="/wallet" class="btn btn-ghost btn-sm">Manage wallet</NuxtLink>
          </div>

          <div class="bill-row">
            <div>
              <div class="bill-label">Card on file</div>
              <div class="bill-value" v-if="card">{{ (card.brand || 'Card') }} ending {{ card.last4 || '••••' }}<span v-if="card.expMonth" class="muted"> · exp {{ card.expMonth }}/{{ card.expYear }}</span></div>
              <div class="bill-value muted" v-else>No card saved</div>
            </div>
            <button class="btn btn-ghost btn-sm" @click="openCardModal">{{ card ? 'Change card' : 'Add card' }}</button>
          </div>
          <p class="muted set-foot card-foot">Card details are handled by our payment provider — Telroi never sees your full card number.</p>
        </div>

        <!-- Workspace -->
        <div v-if="tab === 'workspace'" class="card card-pad">
          <h3 class="set-title">Workspace</h3>
          <div class="field"><label>Company name</label><input v-model="ws.name" class="input" /></div>
          <div class="field"><label>Time zone</label>
            <select v-model="ws.timezone" class="select">
              <option v-for="tz in timezones" :key="tz" :value="tz">{{ tz }}</option>
            </select>
          </div>
          <div class="field"><label>Country</label>
            <select v-model="ws.country" class="select" @change="onCountryChange">
              <option value="">— Select your country —</option>
              <option v-for="c in countryOptions" :key="c" :value="c">{{ c }}</option>
            </select>
            <p class="muted set-foot">Sets your billing currency (Nigeria → ₦ Naira; elsewhere → $ USD) and call routing region.<template v-if="walletFunded"> Your wallet holds a balance, so changing to a different currency isn't possible until it's at zero.</template></p>
          </div>
          <button class="btn btn-signal" :disabled="saving" @click="saveWs">{{ saving ? 'Saving…' : 'Save changes' }}</button>

          <div class="set-divider"></div>

          <h3 class="set-title">Your account</h3>
          <div class="field"><label>Display name</label><input v-model="profile.name" class="input" placeholder="Your name" /></div>
          <button class="btn btn-ghost btn-sm" :disabled="savingProfile" @click="saveProfileName">{{ savingProfile ? 'Saving…' : 'Save name' }}</button>

          <div class="field acct-email-field">
            <label>Email</label>
            <div class="acct-email-row">
              <input v-model="profile.email" class="input" type="email" :disabled="emailStage !== 'idle'" />
              <button v-if="emailStage === 'idle'" class="btn btn-ghost btn-sm" :disabled="profile.email === youEmail || !profile.email" @click="startEmailChange">Verify & save</button>
            </div>
            <p class="muted set-foot">Changing your email requires verifying the new address with a code.</p>

            <div v-if="emailStage === 'code'" class="acct-otp">
              <p class="muted">Enter the 6-digit code we sent to <strong>{{ profile.email }}</strong>.</p>
              <div class="acct-otp-row">
                <input v-model="emailOtp" class="input mono" maxlength="6" placeholder="000000" />
                <button class="btn btn-signal btn-sm" :disabled="verifyingEmail || emailOtp.length !== 6" @click="confirmEmailChange">{{ verifyingEmail ? 'Verifying…' : 'Confirm' }}</button>
                <button class="btn btn-ghost btn-sm" @click="cancelEmailChange">Cancel</button>
              </div>
            </div>
          </div>
        </div>

        <!-- Webhooks -->
        <div v-else-if="tab === 'webhooks'" class="card card-pad">
          <h3 class="set-title">Webhooks</h3>
          <p class="muted set-lede">Telroi pushes call events to your CRM endpoint. This URL is already wired for inbound events.</p>
          <div class="field"><label>Inbound events URL</label><input :value="`${appBase}/api/webhooks/telroi`" class="input mono" readonly /></div>
          <p class="muted set-foot">Authenticated per-workspace by your secure token.</p>
        </div>

        <!-- Members & roles -->
        <div v-else-if="tab === 'team'" class="card card-pad">
          <h3 class="set-title">Members & roles</h3>
          <p class="muted set-lede">Everyone with access to this workspace. Owners and admins manage settings; members use the dashboard.</p>

          <div v-if="members.length" class="mem-list">
            <div v-for="m in members" :key="m.email" class="mem-row">
              <div class="mem-id">
                <span class="mem-avatar">{{ (m.email[0] || '?').toUpperCase() }}</span>
                <span class="mem-email">{{ m.email }}<span v-if="m.email === youEmail" class="mem-you">you</span></span>
              </div>
              <div class="mem-controls">
                <!-- Owner role is fixed; you can't manage yourself or the owner -->
                <select v-if="canManage && m.role !== 'owner' && m.email !== youEmail" class="select mem-role-sel" :value="m.role" @change="changeRole(m.email, ($event.target as HTMLSelectElement).value)">
                  <option value="admin">admin</option>
                  <option value="member">member</option>
                </select>
                <span v-else class="mem-role" :class="m.role">{{ m.role }}</span>
                <button v-if="canManage && m.role !== 'owner' && m.email !== youEmail" class="mem-remove" :disabled="removingMember === m.email" @click="removeMember(m.email)" title="Remove member">✕</button>
              </div>
            </div>
          </div>
          <p v-else class="muted">Loading members…</p>

          <div v-if="canManage" class="mem-invite">
            <input v-model="inviteEmail" class="input" type="email" placeholder="teammate@company.com" />
            <select v-model="inviteRole" class="select mem-role-sel">
              <option value="member">member</option>
              <option value="admin">admin</option>
            </select>
            <button class="btn btn-signal btn-sm" :disabled="inviting || !inviteEmail" @click="inviteMember">{{ inviting ? 'Inviting…' : 'Invite' }}</button>
          </div>
          <p v-else class="muted set-foot">Only owners and admins can invite or manage members.</p>
        </div>

        <!-- Compliance -->
        <div v-else-if="tab === 'compliance'" class="card card-pad">
          <h3 class="set-title">Compliance & documents</h3>
          <p class="muted set-lede">Your accepted agreement and the verification documents on file for this workspace.</p>

          <div class="cmp-doc-row">
            <div class="cmp-doc-info">
              <div class="cmp-doc-name">Data Protection &amp; Privacy Policy</div>
              <div class="cmp-doc-meta" v-if="policyInfo">Accepted{{ policyInfo.version ? ` · v${policyInfo.version}` : '' }}</div>
              <div class="cmp-doc-meta" v-else>On file</div>
            </div>
            <button class="btn btn-ghost btn-sm" @click="openPolicy">View</button>
          </div>

          <template v-if="comp">
            <div class="cmp-doc-row">
              <div class="cmp-doc-info">
                <div class="cmp-doc-name">Business license</div>
                <div class="cmp-doc-meta">{{ comp.businessLicenseName || 'Uploaded' }}</div>
              </div>
              <a v-if="comp.businessLicenseName" class="btn btn-ghost btn-sm" href="/api/compliance/document?doc=business" target="_blank" rel="noopener">View</a>
              <span v-else class="muted cmp-doc-meta">Not uploaded</span>
            </div>
            <div class="cmp-doc-row" v-if="comp.regulatoryLicenseName">
              <div class="cmp-doc-info">
                <div class="cmp-doc-name">Regulatory license</div>
                <div class="cmp-doc-meta">{{ comp.regulatoryLicenseName }}</div>
              </div>
              <a class="btn btn-ghost btn-sm" href="/api/compliance/document?doc=regulatory" target="_blank" rel="noopener">View</a>
            </div>
            <div class="cmp-status-line">
              Verification status:
              <span class="cmp-status-pill" :class="comp.status">{{ comp.status }}</span>
            </div>
          </template>
          <EmptyState v-else icon="quality" title="No documents submitted"
            description="Submit business verification when you switch to live mode from the top bar." />
        </div>
      </div>
    </div>

    <!-- Policy reader modal -->
    <div v-if="showPolicy" class="cmp-policy-overlay" @click.self="showPolicy = false">
      <div class="cmp-policy-modal">
        <div class="cmp-policy-head">
          <div>
            <h3>{{ policyDoc?.title || 'Policy' }}</h3>
            <span class="cmp-policy-ver" v-if="policyDoc">Version {{ policyDoc.version }}</span>
          </div>
          <button class="cmp-policy-x" @click="showPolicy = false">✕</button>
        </div>
        <div class="cmp-policy-body">
          <div v-if="!policyDoc" class="muted">Loading…</div>
          <template v-else>
            <section v-for="(sec, i) in policyDoc.sections" :key="i" class="cmp-policy-sec">
              <h4>{{ sec.heading }}</h4>
              <p v-for="(p, j) in sec.body" :key="j">{{ p }}</p>
            </section>
          </template>
        </div>
      </div>
    </div>

    <!-- Card on file modal -->
    <div v-if="showCardModal" class="cmp-policy-overlay" @click.self="showCardModal = false">
      <div class="cmp-policy-modal card-modal">
        <div class="cmp-policy-head">
          <div><h3>{{ card ? 'Change card on file' : 'Add a card' }}</h3></div>
          <button class="cmp-policy-x" @click="showCardModal = false">✕</button>
        </div>
        <div class="cmp-policy-body">
          <div class="card-secure-note">🔒 Card details are handled securely by our payment provider. Telroi never sees or stores your full card number.</div>
          <!-- PROVIDER ELEMENT MOUNT POINT.
               Replace this block with Stripe Elements / Paystack inline. The SDK
               returns a token + brand/last4 which we POST to /api/payment-method. -->
          <div class="card-field"><label>Cardholder name</label><input v-model="cardName" class="input" placeholder="Name on card" /></div>
          <div id="provider-card-element" class="card-element-placeholder">Secure card field mounts here once your payment provider key is configured.</div>
          <p class="muted set-foot">You're charged $0 today — a card is kept on file for after your trial.</p>
        </div>
        <div class="policy-modal-foot">
          <button class="btn btn-ghost btn-sm" @click="showCardModal = false">Cancel</button>
          <button class="btn btn-signal btn-sm" :disabled="savingCard || !cardName" @click="saveCardFromModal">{{ savingCard ? 'Saving…' : 'Save card' }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, watch } from 'vue';
import { useAuthStore } from '~/stores/auth';
import { useRoute } from 'vue-router';

useHead({ title: 'Settings — Telroi' });
const api = useApi();
const toast = useToast();
const auth = useAuthStore();
const appBase = useRuntimeConfig().public.appBaseUrl;

const tabs = [
  { id: 'plan', label: 'Plan' },
  { id: 'billing', label: 'Billing' },
  { id: 'workspace', label: 'Workspace' },
  { id: 'webhooks', label: 'Webhooks' },
  { id: 'team', label: 'Members' },
  { id: 'compliance', label: 'Compliance' }
];
const route = useRoute();
const tab = ref((route.query.tab as string) || 'plan');
const saving = ref(false);
const switching = ref(false);
const planState = ref<any>(null);
const comp = ref<any>(null);
const policyInfo = ref<{ version?: string } | null>(null);
const showPolicy = ref(false);
const policyDoc = ref<any>(null);

async function loadCompliance() {
  try {
    const r = await api.get<{ compliance: any; policy: any }>('/api/compliance');
    comp.value = r.compliance;
    policyInfo.value = r.policy ? { version: r.policy.version } : null;
  } catch { comp.value = null; }
}
async function openPolicy() {
  showPolicy.value = true;
  if (!policyDoc.value) { try { policyDoc.value = await api.get('/api/policy'); } catch { /* */ } }
}

// Billing
const card = ref<any>(null);
const walletState = ref<any>(null);
const savingCard = ref(false);
const showCardModal = ref(false);
const cardName = ref('');
const walletDisplay = computed(() => {
  const w = walletState.value;
  if (!w) return '—';
  const sym = w.currency === 'NGN' ? '₦' : '$';
  return `${sym}${((w.balanceMinor || 0) / 100).toFixed(2)}`;
});
async function loadBilling() {
  try { card.value = (await api.get<{ card: any }>('/api/payment-method')).card; } catch { card.value = null; }
  try { walletState.value = await api.get('/api/wallet'); } catch { walletState.value = null; }
  try { billSummary.value = await api.get('/api/billing/summary'); } catch { billSummary.value = null; }
}
const billSummary = ref<any>(null);
const recurringDisplay = computed(() => {
  const b = billSummary.value;
  if (!b) return '—';
  const sym = b.currency === 'NGN' ? '₦' : '$';
  return `${sym}${((b.monthlyTotalMinor || 0) / 100).toFixed(2)}`;
});
const walletFunded = computed(() => (walletState.value?.balanceMinor || 0) > 0);
function fmtBillDate(s: string) { try { return new Date(s).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); } catch { return s; } }
function openCardModal() { cardName.value = ''; showCardModal.value = true; }
async function saveCardFromModal() {
  // PLACEHOLDER tokenization. Replace the modal's provider element with Stripe
  // Elements / Paystack inline; its SDK returns a token + brand/last4 which we
  // POST here. Raw card numbers never touch our server.
  savingCard.value = true;
  try {
    const demoToken = `tok_demo_${Date.now()}`;
    await api.post('/api/payment-method', { provider: 'stripe', token: demoToken, brand: 'visa', last4: '4242', expMonth: 12, expYear: 2030 });
    toast.ok('Card saved');
    showCardModal.value = false;
    await loadBilling();
  } catch (e: any) { toast.err(e.message); }
  finally { savingCard.value = false; }
}

// Account profile (display name + email change via OTP)
const profile = reactive({ name: '', email: '' });
const savingProfile = ref(false);
const emailStage = ref<'idle' | 'code'>('idle');
const emailOtp = ref('');
const verifyingEmail = ref(false);
function fmtDate(d: string) { return d ? new Date(d).toLocaleDateString() : ''; }
async function saveProfileName() {
  savingProfile.value = true;
  try { await api.patch('/api/account/profile', { name: profile.name }); toast.ok('Name saved'); }
  catch (e: any) { toast.err(e.message); }
  finally { savingProfile.value = false; }
}
async function startEmailChange() {
  try {
    await api.post('/api/account/email/start', { email: profile.email.trim().toLowerCase() });
    emailStage.value = 'code'; emailOtp.value = '';
    toast.ok('Verification code sent');
  } catch (e: any) { toast.err(e.message); }
}
async function confirmEmailChange() {
  verifyingEmail.value = true;
  try {
    await api.post('/api/account/email/confirm', { email: profile.email.trim().toLowerCase(), code: emailOtp.value });
    toast.ok('Email updated'); emailStage.value = 'idle'; youEmail.value = profile.email.trim().toLowerCase();
    await auth.fetchMe();
  } catch (e: any) { toast.err(e.message); }
  finally { verifyingEmail.value = false; }
}
function cancelEmailChange() { emailStage.value = 'idle'; emailOtp.value = ''; profile.email = youEmail.value; }

// Members
const members = ref<any[]>([]);
const youEmail = ref('');
const yourRole = ref<string | null>(null);
const canManage = computed(() => yourRole.value === 'owner' || yourRole.value === 'admin');
const inviteEmail = ref('');
const inviteRole = ref<'member' | 'admin'>('member');
const inviting = ref(false);
const removingMember = ref<string | null>(null);
async function loadMembers() {
  try { const r = await api.get<{ members: any[]; you: string; yourRole: string }>('/api/tenant/members'); members.value = r.members; youEmail.value = r.you; yourRole.value = r.yourRole; }
  catch { members.value = []; }
}
async function inviteMember() {
  inviting.value = true;
  try {
    await api.post('/api/tenant/members', { email: inviteEmail.value.trim(), role: inviteRole.value });
    toast.ok(`Invited ${inviteEmail.value.trim()}`);
    inviteEmail.value = '';
    await loadMembers();
  } catch (e: any) { toast.err(e.message); }
  finally { inviting.value = false; }
}
async function changeRole(email: string, role: string) {
  try { await api.patch(`/api/tenant/members/${encodeURIComponent(email)}`, { role }); toast.ok('Role updated'); await loadMembers(); }
  catch (e: any) { toast.err(e.message); await loadMembers(); }
}
async function removeMember(email: string) {
  removingMember.value = email;
  try { await api.del(`/api/tenant/members/${encodeURIComponent(email)}`); toast.ok('Member removed'); await loadMembers(); }
  catch (e: any) { toast.err(e.message); }
  finally { removingMember.value = null; }
}
const ws = reactive({ name: '', slug: '', timezone: 'UTC', country: '' });
const timezones = ['UTC', 'Europe/London', 'Europe/Berlin', 'Africa/Lagos', 'America/New_York', 'America/Los_Angeles', 'Asia/Dubai'];
const countryOptions = ['Nigeria', 'Ghana', 'Kenya', 'South Africa', 'United States', 'Canada', 'United Kingdom', 'Germany', 'France', 'United Arab Emirates', 'India', 'Other'];
const savingCountry = ref(false);
async function onCountryChange() {
  if (!ws.country) return;
  savingCountry.value = true;
  try {
    const r = await api.post<any>('/api/tenant/country', { country: ws.country });
    toast.ok(r.walletRealigned ? `Country updated — wallet currency set to ${r.currency}.` : 'Country updated.');
    try { walletState.value = await api.get('/api/wallet'); billSummary.value = await api.get('/api/billing/summary'); } catch { /* */ }
  } catch (e: any) {
    toast.err(e?.data?.error?.message || e?.message || 'Could not update country');
    // revert the select to the persisted value
    if (auth.tenant?.country !== undefined) ws.country = auth.tenant.country || '';
  } finally { savingCountry.value = false; }
}

function planLabel(p: string) { return ({ startup: 'Startup', growth: 'Growth', custom: 'Custom' } as any)[p] || p; }

const { load: loadPlan } = usePlan();
async function refreshPlan() { planState.value = await api.get('/api/plan'); }
async function switchPlan(p: string) {
  switching.value = true;
  try {
    await api.post('/api/plan/switch', { plan: p });
    await refreshPlan();
    await loadPlan(true);
    toast.ok(p === 'growth' ? 'Upgraded to Growth' : 'Switched to Startup');
  } catch (e: any) { toast.err(e.message); }
  finally { switching.value = false; }
}

onMounted(() => {
  if (auth.tenant) Object.assign(ws, { name: auth.tenant.name, slug: auth.tenant.slug, timezone: auth.tenant.timezone, country: auth.tenant.country || '' });
  if (auth.user) { profile.name = (auth.user as any).name || ''; profile.email = auth.user.email; youEmail.value = auth.user.email; }
  refreshPlan();
  loadCompliance();
});

watch(tab, async (t) => {
  if (t === 'billing') loadBilling();
  if (t === 'team' && !members.value.length) loadMembers();
}, { immediate: true });

async function saveWs() {
  saving.value = true;
  try {
    await api.patch('/api/tenant', { name: ws.name, timezone: ws.timezone });
    await auth.fetchMe();
    toast.ok('Saved');
  } catch (e: any) { toast.err(e.message); }
  finally { saving.value = false; }
}
</script>

<style scoped>
.settings-layout { display: grid; grid-template-columns: 200px 1fr; gap: 24px; }
.set-nav { display: flex; flex-direction: column; gap: 2px; }
.set-nav-item { text-align: left; padding: 10px 14px; border-radius: var(--radius-sm); font-size: 14px; color: var(--ink-soft); transition: background 0.12s, color 0.12s; }
.set-nav-item:hover { background: var(--paper-3); color: var(--ink); }
.set-nav-item.active { background: var(--signal-soft); color: var(--signal); font-weight: 500; }
.set-title { font-family: var(--font-display); font-size: 20px; margin-bottom: 20px; }
.set-divider { height: 1px; background: var(--rule); margin: 36px 0; }
.set-lede { font-size: 13.5px; margin-bottom: 20px; }
.set-foot { font-size: 12.5px; margin-top: 8px; }
.inline-link { color: var(--signal); }

.dom-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; }
.dom-stat { background: var(--paper-2); border-radius: var(--radius); padding: 14px 16px; display: flex; flex-direction: column; gap: 4px; }
.dom-label { font-family: var(--font-mono); font-size: 10.5px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink-mute); }
.dom-val { font-size: 16px; font-weight: 500; }

@media (max-width: 820px) {
  .settings-layout { grid-template-columns: 1fr; }
  .set-nav { flex-direction: row; overflow-x: auto; }
}
.plan-current { display: flex; align-items: center; justify-content: space-between; padding: 16px 18px; background: var(--paper-2); border-radius: var(--radius); margin-bottom: 16px; }
.plan-current-name { font-size: 16px; font-weight: 600; color: var(--ink); display: flex; align-items: center; gap: 10px; }
.plan-trial-chip { font-size: 11px; font-weight: 500; color: var(--signal); background: var(--signal-soft); padding: 2px 8px; border-radius: 999px; }
.plan-current-sub { font-size: 13px; color: var(--ink-soft); margin-top: 2px; }
.plan-trial-banner { font-size: 13px; color: var(--signal-2); background: var(--signal-soft); border-radius: var(--radius); padding: 12px 16px; margin-bottom: 18px; line-height: 1.5; }
.plan-options { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.plan-opt { border: 1px solid var(--rule); border-radius: var(--radius-lg); padding: 18px; }
.plan-opt.on { border-color: var(--signal); background: var(--signal-soft); }
.plan-opt-head { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 8px; }
.plan-opt-name { font-family: var(--font-display); font-size: 17px; color: var(--ink); }
.plan-opt-price { font-size: 18px; font-weight: 600; color: var(--ink); }
.plan-opt-price small { font-size: 11px; font-weight: 400; color: var(--ink-mute); }
.plan-opt-desc { font-size: 12.5px; color: var(--ink-soft); line-height: 1.5; margin-bottom: 14px; }
.plan-opt-current { display: block; text-align: center; font-size: 12.5px; color: var(--signal); font-weight: 500; padding: 7px; }
.btn-block { width: 100%; }
@media (max-width: 560px) { .plan-options { grid-template-columns: 1fr; } }
.cmp-doc-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 14px 0; border-bottom: 1px solid var(--rule-2); }
.cmp-doc-row:last-of-type { border-bottom: none; }
.cmp-doc-name { font-size: 14px; font-weight: 500; color: var(--ink); }
.cmp-doc-meta { font-size: 12.5px; color: var(--ink-mute); margin-top: 2px; word-break: break-all; }
.cmp-status-line { font-size: 13px; color: var(--ink-soft); margin-top: 16px; display: flex; align-items: center; gap: 8px; }
.cmp-status-pill { font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; padding: 2px 8px; border-radius: 999px; font-weight: 600; background: var(--paper-3); color: var(--ink-mute); }
.cmp-status-pill.approved { background: rgba(0,210,138,0.14); color: #0a8a5c; }
.cmp-status-pill.pending { background: rgba(183,121,31,0.14); color: var(--warn); }
.cmp-status-pill.rejected { background: rgba(192,57,43,0.12); color: var(--danger); }
.cmp-empty { margin-top: 8px; }
.cmp-policy-overlay { position: fixed; inset: 0; z-index: 300; background: rgba(10,10,11,0.4); display: flex; align-items: center; justify-content: center; padding: 24px; }
.cmp-policy-modal { width: 100%; max-width: 640px; max-height: 86vh; background: var(--paper); border-radius: var(--radius-lg); display: flex; flex-direction: column; overflow: hidden; }
.cmp-policy-head { display: flex; align-items: flex-start; justify-content: space-between; padding: 22px 26px; border-bottom: 1px solid var(--rule); }
.cmp-policy-head h3 { font-family: var(--font-display); font-size: 19px; color: var(--ink); }
.cmp-policy-ver { font-size: 11.5px; color: var(--ink-mute); }
.cmp-policy-x { color: var(--ink-mute); font-size: 16px; }
.cmp-policy-body { overflow-y: auto; padding: 8px 26px 22px; }
.cmp-policy-sec { margin-top: 16px; }
.cmp-policy-sec h4 { font-size: 14px; color: var(--ink); margin-bottom: 6px; }
.cmp-policy-sec p { font-size: 13px; color: var(--ink-soft); line-height: 1.6; margin: 0 0 8px; }
.bill-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 16px 0; border-bottom: 1px solid var(--rule-2); }
.bill-row:last-child { border-bottom: none; }
.bill-label { font-size: 12.5px; color: var(--ink-mute); }
.bill-value { font-size: 16px; color: var(--ink); font-weight: 500; margin-top: 3px; }
.bill-note { font-size: 12px; }
.ai-conn-list { display: flex; flex-direction: column; gap: 8px; margin-bottom: 16px; }
.ai-conn-row { display: flex; align-items: center; justify-content: space-between; padding: 11px 14px; border: 1px solid var(--rule); border-radius: var(--radius); }
.ai-conn-name { font-size: 14px; color: var(--ink); }
.ai-conn-status { font-size: 12px; color: #0a8a5c; background: rgba(0,210,138,0.12); padding: 2px 9px; border-radius: 999px; }
.ai-add { display: flex; gap: 8px; align-items: center; }
.ai-add .select { max-width: 200px; }
.ai-add .input { flex: 1; }
.key-fresh { background: var(--signal-soft); border: 1px solid var(--signal); border-radius: var(--radius); padding: 14px 16px; margin-bottom: 16px; }
.key-fresh-label { font-size: 12.5px; color: var(--signal-2); margin-bottom: 8px; }
.key-fresh-val { display: block; font-size: 13px; word-break: break-all; background: var(--paper); padding: 8px 10px; border-radius: 6px; margin-bottom: 8px; }
.key-list { display: flex; flex-direction: column; gap: 8px; margin-bottom: 16px; }
.key-row { display: flex; align-items: center; justify-content: space-between; padding: 11px 14px; border: 1px solid var(--rule); border-radius: var(--radius); }
.key-name { font-size: 14px; color: var(--ink); font-weight: 500; }
.key-mode { font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; padding: 1px 6px; border-radius: 999px; margin-left: 6px; background: var(--paper-3); color: var(--ink-mute); }
.key-mode.live { background: rgba(0,210,138,0.12); color: #0a8a5c; }
.key-meta { font-size: 12px; color: var(--ink-mute); margin-top: 2px; }
.key-revoke { color: var(--danger); }
.key-add { display: flex; gap: 8px; align-items: center; }
.key-add .input { flex: 1; }
.key-mode-sel { max-width: 110px; }
.mem-list { display: flex; flex-direction: column; gap: 6px; margin-bottom: 14px; }
.mem-row { display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; border: 1px solid var(--rule); border-radius: var(--radius); }
.mem-id { display: flex; align-items: center; gap: 11px; }
.mem-avatar { width: 30px; height: 30px; border-radius: 50%; background: var(--signal-soft); color: var(--signal); display: flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 600; }
.mem-email { font-size: 14px; color: var(--ink); }
.mem-you { font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--ink-mute); background: var(--paper-3); padding: 1px 6px; border-radius: 999px; margin-left: 8px; }
.mem-role { font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--ink-mute); background: var(--paper-2); padding: 3px 10px; border-radius: 999px; }
.mem-role.owner { background: var(--signal-soft); color: var(--signal); }
.mem-controls { display: flex; align-items: center; gap: 8px; }
.mem-role-sel { max-width: 110px; padding: 5px 10px; font-size: 12.5px; }
.mem-remove { color: var(--ink-mute); font-size: 14px; width: 26px; height: 26px; border-radius: var(--radius-sm); transition: background 0.12s, color 0.12s; }
.mem-remove:hover { background: rgba(192,57,43,0.1); color: var(--danger); }
.mem-invite { display: flex; gap: 8px; align-items: center; margin-top: 16px; }
.mem-invite .input { flex: 1; }
.ai-conn-right { display: flex; align-items: center; gap: 10px; }
.ai-conn-del { color: var(--ink-mute); font-size: 13px; width: 24px; height: 24px; border-radius: var(--radius-sm); transition: background 0.12s, color 0.12s; }
.ai-conn-del:hover { background: rgba(192,57,43,0.1); color: var(--danger); }
.card-foot { margin-top: 14px; }
.bill-sub { font-size: 13px; font-weight: 400; }
.bill-mini { font-size: 12px; margin-top: 3px; }
.bill-next { text-align: right; }

</style>
