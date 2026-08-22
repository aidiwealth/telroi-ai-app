<template>
  <div>
    <div class="page-head num-head">
      <div>
        <h1 class="page-title">Numbers</h1>
        <p class="page-sub">Your phone numbers and how incoming calls route to people, departments or AI.</p>
      </div>
      <div class="num-head-right">
        <div v-if="channels" class="channels-pill" :class="{ busy: channels.available === 0 && channels.capacity > 0 }" :title="'Simultaneous calls you can handle, set by your channels.'">
          <span class="channels-dot"></span>
          {{ channels.inUse }} / {{ channels.capacity }} channels in use
        </div>
        <button class="btn btn-signal btn-sm" @click="openBuy">+ Buy number</button>
      </div>
    </div>

    <div class="card num-table">
      <div v-if="pending" class="loading-pad">
        <div v-for="i in 4" :key="i" class="skeleton skel-row" />
      </div>
      <table v-else-if="numbers.length" class="table">
        <thead><tr><th>Number</th><th>Routes to</th><th>Greeting</th><th>Status</th><th></th></tr></thead>
        <tbody>
          <tr v-for="n in numbers" :key="n.telnum">
            <td class="mono num-cell">
              {{ n.telnum }}
              <span v-if="n.is_main_phone" class="chip main-chip">Main</span>
            </td>
            <td>
              <span class="route-to">{{ routeLabel(n) }}</span>
              <span v-if="n.location" class="muted loc"> · {{ n.location }}</span>
            </td>
            <td>{{ n.greeting ? 'On' : '—' }}</td>
            <td><span class="chip" :class="n.disabled ? 'chip--missed' : 'chip--ok'">{{ n.disabled ? 'Disabled' : 'Active' }}</span></td>
            <td class="row-actions">
              <button class="btn btn-ghost btn-sm" @click="edit(n)">Edit routing</button>
            </td>
          </tr>
        </tbody>
      </table>
      <EmptyState v-else icon="numbers" title="No numbers yet"
        description="Once a number is added to your account, it'll appear here." />
    </div>

    <!-- Channels: per-number capacity + adjust (prorated) -->
    <div v-if="subs.length" class="card chan-card">
      <div class="chan-head">
        <div>
          <h2 class="chan-title">Channels</h2>
          <p class="chan-sub">Channels set how many simultaneous calls each number can handle. You're billed monthly per channel; adding channels mid-cycle is prorated.</p>
        </div>
      </div>
      <table class="table">
        <thead><tr><th>Number</th><th>Channels</th><th>Monthly</th><th></th></tr></thead>
        <tbody>
          <tr v-for="sub in subs" :key="sub.id">
            <td class="mono">{{ sub.telnum }}</td>
            <td>{{ sub.channels }}</td>
            <td class="mono muted">{{ money(sub.channels * channelMonthly) }}</td>
            <td class="row-actions">
              <template v-if="sub.status === 'active'">
                <button class="btn btn-ghost btn-sm" @click="openAdjust(sub)">Adjust</button>
                <button class="btn btn-ghost btn-sm num-release" @click="releaseNumber(sub)">Release</button>
              </template>
              <template v-else>
                <span class="num-grace">Released · reserved until {{ sub.graceEndsAt ? new Date(sub.graceEndsAt).toLocaleDateString() : 'soon' }}</span>
                <button class="btn btn-signal btn-sm" @click="reclaimNumber(sub)">Reclaim</button>
              </template>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Adjust-channels modal -->
    <Transition name="drawer">
      <div v-if="adjust.sub" class="drawer-overlay" @click.self="closeAdjust">
        <aside class="drawer chan-drawer">
          <div class="drawer-head">
            <span class="drawer-sub">Channels</span>
            <button class="modal-x" @click="closeAdjust">✕</button>
          </div>
          <h2 class="drawer-num mono">{{ adjust.sub.telnum }}</h2>
          <p class="muted" style="margin:0 0 16px">Currently {{ adjust.sub.channels }} channel{{ adjust.sub.channels > 1 ? 's' : '' }}.</p>
          <div class="field">
            <label>New channel count</label>
            <input v-model.number="adjust.next" type="number" min="1" max="50" class="input mono" />
          </div>
          <div v-if="adjust.next > adjust.sub.channels" class="chan-quote">
            <div class="chan-quote-row"><span>{{ adjust.next - adjust.sub.channels }} added channel{{ (adjust.next - adjust.sub.channels) > 1 ? 's' : '' }} · prorated, {{ daysLeft }} day(s) left</span><span class="mono">{{ money(proratedEstimate) }}</span></div>
            <div class="chan-quote-row muted"><span>From next billing date</span><span class="mono">{{ money(adjust.next * channelMonthly) }}/mo</span></div>
          </div>
          <div v-else-if="adjust.next < adjust.sub.channels" class="chan-quote">
            <div class="chan-quote-row muted"><span>Reduced — no charge now. New lower fee applies from your next billing date.</span></div>
            <div class="chan-quote-row"><span>From next billing date</span><span class="mono">{{ money(adjust.next * channelMonthly) }}/mo</span></div>
          </div>
          <button class="btn btn-signal btn-block" :disabled="adjusting || adjust.next === adjust.sub.channels" @click="confirmAdjust">
            {{ adjusting ? 'Saving…' : (adjust.next > adjust.sub.channels ? 'Confirm & pay prorated' : 'Confirm change') }}
          </button>
          <p class="muted chan-fineprint">Increases are charged now (prorated for the days left this cycle). Decreases take effect at your next billing date.</p>
        </aside>
      </div>
    </Transition>

    <!-- Unified routing editor — same for every number regardless of carrier -->
    <Transition name="drawer">
      <div v-if="editing" class="drawer-overlay" @click.self="editing = null">
        <aside class="drawer">
          <div class="drawer-head">
            <span class="drawer-sub">Routing</span>
            <button class="modal-x" @click="editing = null">✕</button>
          </div>
          <h2 class="drawer-num mono">{{ editing.telnum }}</h2>
          <div class="field">
            <label>Route incoming calls to</label>
            <select v-model="editing.routeType" class="select">
              <option value="person">A person</option>
              <option value="department">A department / queue</option>
              <option value="ai">An AI agent</option>
            </select>
          </div>

          <!-- Recording. Off by default, because a client should choose which
               lines are recorded rather than discover all of them were — and
               callers are told at the start of every one, which is the law and
               also simply decent. -->
          <!-- Separate from inbound, because the obligations differ: somebody
               who rings you chose a recorded line, somebody you ring did not.
               They are told when they answer, before the conversation. -->
          <label class="num-rec">
            <input type="checkbox" v-model="editing.recordOutbound" />
            <span>
              <strong>Record calls made from this number</strong>
              <span class="num-rec-note">The person you call hears a notice when they answer, before you are connected — they did not choose a recorded line, so they are told.</span>
            </span>
          </label>

          <label class="num-rec">
            <input type="checkbox" v-model="editing.recordCalls" />
            <span>
              <strong>Record calls on this number</strong>
              <span class="num-rec-note">Callers hear a short notice before the call connects. Recordings are kept for the period your plan allows, and switching this off later does not delete what has already been recorded.</span>
            </span>
          </label>

          <div v-if="editing.routeType === 'person'" class="field-float">
            <input v-model="editing.target" class="input" placeholder=" " id="num-target" />
            <label for="num-target">Person (name or extension)</label>
          </div>

          <div v-else-if="editing.routeType === 'department'" class="field">
            <label>Department</label>
            <select v-model="editing.departmentId" class="select">
              <option value="">— Select a department —</option>
              <option v-for="d in departments" :key="d.id" :value="d.id">{{ d.name }}</option>
            </select>
            <span v-if="!departments.length" class="muted" style="font-size:12px">No departments yet — create one in Settings.</span>
          </div>

          <template v-else>
            <div class="field">
              <label>AI agent</label>
              <select v-model="editing.agentId" class="select">
                <option value="">— Select an AI agent —</option>
                <option v-for="a in agents" :key="a.id" :value="a.id">{{ a.name }}</option>
              </select>
              <span v-if="!agents.length" class="muted" style="font-size:12px">No AI agents yet — create one under AI Numbers.</span>
            </div>
            <div class="field">
              <label>Escalate to (human handoff)</label>
              <select v-model="editing.escalateTo" class="select">
                <option value="">— No human handoff —</option>
                <!-- The commonest choice, and it was missing: an AI line with no
                     fallback answers, decides somebody needs a person, and then
                     has nowhere to send them. -->
                <option value="__all">Anyone available</option>
                <option v-for="t in escalationTargets" :key="t.id" :value="t.id">{{ t.label }}</option>
              </select>
              <span v-if="!escalationTargets.length" class="muted" style="font-size:12px">No people to escalate to yet — add a SIP user first.</span>
            </div>
            <div class="field">
              <label>Escalate after (seconds, 0 = on intent)</label>
              <input v-model.number="editing.escalateAfter" type="number" min="0" max="600" class="input mono" />
            </div>
          </template>

          <button class="btn btn-signal btn-block" :disabled="savingRoute" @click="save">{{ savingRoute ? 'Saving…' : 'Save routing' }}</button>
          <p class="muted save-note">One routing setup for every number. Choose a person, a department, or an AI agent — we connect the call behind the scenes.</p>
        </aside>
      </div>
    </Transition>

    <!-- Buy number modal -->
    <div v-if="showBuy" class="modal-overlay" @click.self="showBuy = false">
      <div class="modal card buy-modal">
        <div class="card-head">
          <span class="card-title">Buy a number</span>
          <button class="modal-x" @click="showBuy = false">&times;</button>
        </div>

        <div class="card-pad">
          <p v-if="!available.length" class="muted buy-empty">No numbers are available right now. Check back soon.</p>

          <!-- Verification first, and before anything else is shown: a client
               who cannot buy should not be walked through choosing. -->
          <div v-else-if="!approved" class="buy-gate">
            <p class="buy-gate-h">{{ complianceStatus === 'pending' ? 'Your verification is under review' : 'Verification comes first' }}</p>
            <p class="buy-gate-p">
              {{ complianceStatus === 'pending'
                ? 'Numbers open up as soon as it is approved — usually within a working day.'
                : 'Numbers carry a real identity on the network, so we verify a business before selling one.' }}
              <template v-if="demoNumber"> Meanwhile you can place test calls from <strong class="mono">{{ demoNumber }}</strong>.</template>
            </p>
            <button v-if="complianceStatus !== 'pending'" class="btn btn-signal btn-block" @click="goVerify">Start verification</button>
          </div>

          <template v-else>
            <!-- One panel at a time. The indemnity used to arrive as a second
                 modal after somebody thought they had finished, which is a poor
                 moment to meet a legal document. -->
            <div class="buy-steps">
              <div v-for="(label, i) in stepLabels" :key="label"
                   class="buy-step" :class="{ on: step === i, done: step > i }">
                <span class="buy-step-n">{{ step > i ? '&check;' : i + 1 }}</span>
                <span class="buy-step-l">{{ label }}</span>
              </div>
            </div>

            <!-- 1 · the number -->
            <template v-if="step === 0">
              <div class="buy-list">
                <button v-for="a in available" :key="a.id" class="buy-pick" :class="{ on: picked?.id === a.id }" @click="picked = a">
                  <span class="buy-pick-num mono">{{ a.telnum }}</span>
                  <span class="buy-pick-meta"><span class="buy-flag">{{ a.regionLabel }}</span></span>
                </button>
              </div>
            </template>

            <!-- 2 · what it is for, and how much capacity -->
            <template v-else-if="step === 1">
              <div class="field buy-channels">
                <label>Voice channels</label>
                <input v-model.number="buy.channels" type="number" min="1" max="50" class="input mono" />
                <p class="ad-hint">One channel is one call at a time. A second caller hears busy until there is another.</p>
              </div>

              <div class="buy-cats">
                <div class="buy-cats-h">What will this number be used for?</div>
                <label v-for="c in USE_CATEGORIES" :key="c.key" class="buy-cat">
                  <input type="checkbox" :value="c.key" v-model="buy.categories" @change="onCategory(c.key)" />
                  <span><strong>{{ c.label }}</strong> — {{ c.hint }}</span>
                </label>
                <p v-if="needsIndemnity" class="ad-hint">This use carries the Number Use Indemnity, which you will read at the next step.</p>
              </div>
            </template>

            <!-- 3 · the indemnity, only when it applies -->
            <template v-else-if="step === 2 && needsIndemnity">
              <div v-if="indemnity">
                <p class="ind-sub muted">{{ indemnity.title }} · version {{ indemnity.version }}</p>
                <div class="ind-body" @scroll="onIndemnityScroll" v-html="indemnityHtml"></div>
                <p v-if="!readToEnd" class="ind-note muted">Scroll to the end to continue.</p>
                <p v-else class="ind-note muted">Your acceptance is recorded with your name, this number, this version and the time.</p>
              </div>
              <p v-else class="muted">Loading&hellip;</p>
            </template>

            <!-- 4 · what they are agreeing to buy -->
            <template v-else>
              <div class="buy-pricing">
                <div class="buy-row"><span>Number</span><span class="mono">{{ picked?.telnum }}</span></div>
                <div class="buy-row"><span>Number (DID) &middot; monthly</span><span class="mono">{{ money(didMonthly) }}</span></div>
                <div class="buy-row"><span>{{ buy.channels }} channel{{ buy.channels > 1 ? 's' : '' }} &middot; monthly</span><span class="mono">{{ money(buy.channels * channelMonthly) }}</span></div>
                <div class="buy-row buy-total"><span>Due now (first month)</span><span class="mono">{{ money(didMonthly + buy.channels * channelMonthly) }}</span></div>
                <div class="buy-row buy-airtime muted"><span>Airtime</span><span>{{ airtimeLabel }} / min, billed per call</span></div>
                <div class="buy-row buy-airtime muted"><span>Declared use</span><span>{{ categoryLabels }}</span></div>
                <div v-if="acceptedVersion" class="buy-row buy-airtime muted"><span>Indemnity</span><span>Accepted &middot; v{{ acceptedVersion }}</span></div>
              </div>
              <p class="muted buy-note">Charged now, then monthly. A low balance blocks the purchase.</p>
            </template>

            <div class="buy-actions">
              <button v-if="step > 0" class="btn btn-ghost" :disabled="buying || indemnityBusy" @click="stepBack">Back</button>
              <button class="btn btn-signal" :disabled="!canAdvance || buying || indemnityBusy" @click="stepNext">
                {{ advanceLabel }}
              </button>
            </div>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, nextTick } from 'vue';
import type { TelroiNumber } from '~/server/utils/telroi/client';

useHead({ title: 'Numbers — Telroi' });
const api = useApi();
const toast = useToast();

const pending = ref(true);
const numbers = ref<TelroiNumber[]>([]);
const channels = ref<{ capacity: number; inUse: number; available: number } | null>(null);
const subs = ref<any[]>([]);
const approved = ref(false);
const complianceStatus = ref<string | null>(null);
const demoNumber = ref<string | null>(null);

// The go-live endpoint already knows all three; a client refused a purchase
// needs to know what to do next and what they can still do meanwhile.
async function loadGoLive() {
  try {
    const r = await api.get<any>('/api/go-live');
    approved.value = !!r.approved;
    complianceStatus.value = r.complianceStatus || null;
    demoNumber.value = r.demoNumber || null;
  } catch { /* the list is still worth showing */ }
}

function goVerify() { navigateTo('/settings?tab=compliance'); }

const channelMonthly = ref(2);          // per channel/month, in the workspace's currency
const didMonthly = ref(1.7);            // per number/month, same
const airtimePerMin = ref(0.0102);
const airtimeLabel = computed(() => {
  // Per-minute rates run to four decimals in dollars and none in naira; one
  // format would either lose the rate or pad it with meaningless zeros.
  const v = airtimePerMin.value;
  return `${currencySym.value}${v < 1 ? v.toFixed(4) : v.toFixed(2)}`;
});
const currencySym = ref('$');
const adjust = ref<{ sub: any | null; next: number }>({ sub: null, next: 1 });
const adjusting = ref(false);

function money(v: number) { return `${currencySym.value}${(v).toFixed(2)}`; }
const daysLeft = computed(() => {
  if (!adjust.value.sub?.nextBillingAt) return 30;
  const ms = new Date(adjust.value.sub.nextBillingAt).getTime() - Date.now();
  return Math.max(1, Math.min(30, Math.ceil(ms / 86400000)));
});
const proratedEstimate = computed(() => {
  if (!adjust.value.sub) return 0;
  const added = Math.max(0, adjust.value.next - adjust.value.sub.channels);
  return +(channelMonthly.value * added * (daysLeft.value / 30)).toFixed(2);
});
function openAdjust(sub: any) { adjust.value = { sub, next: sub.channels }; }
async function releaseNumber(sub: any) {
  if (!confirm(`Release ${sub.telnum}? Billing stops now. It stays reserved to you for 7 days (you can reclaim it), then returns to the pool.`)) return;
  try {
    const r = await api.post<any>(`/api/numbers/${sub.id}/release`, {});
    toast.ok(r.message || 'Number released');
    await loadSubs();
  } catch (e: any) { toast.err(e.message); }
}
async function reclaimNumber(sub: any) {
  try {
    const r = await api.post<any>(`/api/numbers/${sub.id}/reclaim`, {});
    toast.ok(r.message || 'Number re-activated');
    await loadSubs();
  } catch (e: any) { toast.err(e.message); }
}
function closeAdjust() { adjust.value = { sub: null, next: 1 }; }
async function confirmAdjust() {
  if (!adjust.value.sub || adjust.value.next === adjust.value.sub.channels) return;
  adjusting.value = true;
  try {
    const r = await api.post<any>(`/api/numbers/${adjust.value.sub.id}/channels`, { channels: adjust.value.next });
    toast.ok(r.note || 'Channels updated.');
    closeAdjust();
    await loadSubs();
    try { channels.value = await api.get('/api/numbers/channels'); } catch { /* */ }
  } catch (e: any) { toast.err(e?.data?.error?.message || e?.message || 'Could not update channels'); }
  finally { adjusting.value = false; }
}
async function loadSubs() {
  try {
    // Channels lists every subscription, including released ones — that row is
  // where a client reclaims a number during its grace period. (Filtering this to
  // active-only hid the Reclaim button; the Numbers list above reads `numbers`,
  // not `subs`, so it was never the thing showing released numbers anyway.)
  subs.value = await api.get<any[]>('/api/numbers/subscriptions');
  } catch { subs.value = []; }
}
const editing = ref<any>(null);
const savingRoute = ref(false);
const agents = ref<any[]>([]);
const departments = ref<any[]>([]);
const escalationTargets = ref<Array<{ id: string; label: string }>>([]);
const showBuy = ref(false);
const buying = ref(false);
const available = ref<any[]>([]);
const picked = ref<any>(null);
const buy = ref({ channels: 1, categories: [] as string[] });

// The six from section 2 of the indemnity, plus the ordinary case. Keeping the
// wording close to the document matters: a client ticking "Authentication" here
// should recognise the same word when they read what they are signing.
const USE_CATEGORIES = [
  { key: 'general',        label: 'General business', hint: 'Ordinary calls to and from your business.', sensitive: false },
  { key: 'authentication', label: 'Authentication',   hint: 'One-time passcodes, verification, transaction alerts.', sensitive: true },
  { key: 'financial',      label: 'Financial services', hint: 'Banking, payments, lending, collections, insurance.', sensitive: true },
  { key: 'health',         label: 'Health & sensitive data', hint: 'Medical, insurance, or special-category data.', sensitive: true },
  { key: 'emergency',      label: 'Emergency & welfare', hint: 'Crisis, safety, welfare and helpline services.', sensitive: true },
  { key: 'government',     label: 'Government & public sector', hint: 'Public authority, civic and electoral.', sensitive: true },
  { key: 'outbound',       label: 'Scaled outbound',  hint: 'Campaigns at volume, or automated and AI dialling.', sensitive: true }
];

const needsIndemnity = computed(() =>
  buy.value.categories.some((k) => USE_CATEGORIES.find((c) => c.key === k)?.sensitive));

/** "This is an ordinary line" and "this is for OTPs" cannot both be true, so
 *  general is exclusive in both directions. */
function onCategory(key: string) {
  const cats = buy.value.categories;
  if (key === 'general' && cats.includes('general')) buy.value.categories = ['general'];
  else if (key !== 'general') buy.value.categories = cats.filter((c) => c !== 'general');
}

async function openBuy() {
  showBuy.value = true; picked.value = null;
  try { const r = await api.get<any>('/api/numbers/available'); available.value = r.numbers || []; }
  catch (e: any) { toast.err(e.message); }
}

// ── The indemnity ────────────────────────────────────────────────────────────
// Shown in full rather than summarised behind a link. Somebody is giving an
// indemnity; the least we can do is put the words in front of them.
// ── The buy flow, as steps ───────────────────────────────────────────────────
// The indemnity used to open as a second modal once somebody thought they had
// finished. Meeting a legal document at that moment is both a poor experience
// and a poor consent: it reads as an obstacle rather than something to weigh.
const step = ref(0);
const acceptedVersion = ref<string | null>(null);

// The indemnity step exists only when it applies, so the numbering a client
// sees matches the steps they will actually take.
const stepLabels = computed(() => needsIndemnity.value
  ? ['Number', 'Use', 'Indemnity', 'Confirm']
  : ['Number', 'Use', 'Confirm']);

const categoryLabels = computed(() => buy.value.categories
  .map((k) => USE_CATEGORIES.find((c) => c.key === k)?.label || k).join(', '));

const canAdvance = computed(() => {
  if (step.value === 0) return !!picked.value;
  if (step.value === 1) return buy.value.categories.length > 0;
  if (step.value === 2 && needsIndemnity.value) return readToEnd.value;
  return true;
});

const advanceLabel = computed(() => {
  if (buying.value) return 'Processing…';
  if (indemnityBusy.value) return 'Recording…';
  const last = stepLabels.value.length - 1;
  if (step.value === last) return 'Buy & charge wallet';
  if (step.value === 2 && needsIndemnity.value) return 'Accept and continue';
  return 'Continue';
});

function stepBack() {
  // Going back past the indemnity discards the acceptance rather than keeping
  // it: they may change what the number is for, and an acceptance covering
  // categories they have since edited would not be worth having.
  if (step.value === 3) acceptedVersion.value = null;
  step.value = Math.max(0, step.value - 1);
}

async function stepNext() {
  const last = stepLabels.value.length - 1;
  if (step.value === last) return doPurchase();
  if (step.value === 1 && needsIndemnity.value) { await openIndemnity(); step.value = 2; return; }
  if (step.value === 2 && needsIndemnity.value) {
    // Their agreement is held here and recorded by the purchase. Nothing is
    // written for a number they do not end up buying.
    acceptedVersion.value = indemnity.value?.version || null;
    step.value = 3;
    return;
  }
  step.value = step.value + 1;
}

const indemnity = ref<any>(null);

/** The document renders as markdown rather than as raw text — a thing somebody
 *  is signing should not show its own asterisks.
 *
 *  Written out rather than pulled from a library because this goes through
 *  v-html: every angle bracket is escaped first, and only the handful of tags
 *  produced below can ever reach the page. The text is ours, from our own
 *  repository, but a renderer that would pass HTML through is a habit worth not
 *  forming.
 */
const indemnityHtml = computed(() => {
  const md = indemnity.value?.body || '';
  const esc = (t: string) => t
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const inline = (t: string) => esc(t)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');

  const out: string[] = [];
  let list = false;
  const closeList = () => { if (list) { out.push('</ul>'); list = false; } };

  for (const raw of md.split('\n')) {
    const line = raw.trimEnd();
    if (/^---+$/.test(line.trim())) { closeList(); continue; }   // rules are the h2 borders
    if (/^## /.test(line))  { closeList(); out.push(`<h2>${inline(line.slice(3))}</h2>`); continue; }
    if (/^# /.test(line))   { closeList(); out.push(`<h1>${inline(line.slice(2))}</h1>`); continue; }
    if (/^- /.test(line))   { if (!list) { out.push('<ul>'); list = true; } out.push(`<li>${inline(line.slice(2))}</li>`); continue; }
    if (!line.trim())       { closeList(); continue; }
    // A paragraph continues until a blank line, so wrapped source lines join.
    const prev = out[out.length - 1];
    if (!list && prev && prev.startsWith('<p>') && !prev.endsWith('</p>')) out[out.length - 1] = prev + ' ' + inline(line);
    else if (!list && prev && prev.startsWith('<p>') && prev.endsWith('</p>')) out[out.length - 1] = prev.slice(0, -4) + ' ' + inline(line) + '</p>';
    else out.push(`<p>${inline(line)}</p>`);
  }
  closeList();
  return out.join('\n');
});
const indemnityBusy = ref(false);
const readToEnd = ref(false);

/** Enabled only once they have reached the bottom. It is a low bar and easily
 *  gamed, but a tick box beside unscrolled text is worse: it records agreement
 *  to something demonstrably unread. */
function atEnd(el: HTMLElement) {
  // A generous margin: sub-pixel heights and browser zoom mean the exact
  // arithmetic rarely lands on zero, and a button that will not enable however
  // far somebody scrolls is worse than one that enables a line early.
  return el.scrollTop + el.clientHeight >= el.scrollHeight - 48;
}

function onIndemnityScroll(e: Event) {
  if (atEnd(e.target as HTMLElement)) readToEnd.value = true;
}

/** A document shorter than its box has nothing to scroll, so waiting for a
 *  scroll event would leave the button disabled forever. Checked once the text
 *  has been laid out. */
async function checkIndemnityFits() {
  await nextTick();
  const el = document.querySelector('.ind-body') as HTMLElement | null;
  if (el && el.scrollHeight <= el.clientHeight + 8) readToEnd.value = true;
}

async function openIndemnity() {
  indemnityBusy.value = true;
  try {
    const r = await api.get<any>('/api/legal/number_indemnity');
    indemnity.value = r.document;
    readToEnd.value = false;
    void checkIndemnityFits();
  } catch (e: any) {
    toast.err(e?.data?.error?.message || 'Could not load the indemnity. Please try again.');
  } finally { indemnityBusy.value = false; }
}

async function doPurchase() {
  if (!picked.value) return;
  buying.value = true;
  try {
    await api.post('/api/numbers/purchase', {
      inventoryId: picked.value.id, channels: buy.value.channels,
      categories: buy.value.categories,
      indemnityDocumentId: needsIndemnity.value ? indemnity.value?.id : undefined
    });
    toast.ok('Number purchased — wallet charged');
    showBuy.value = false;
    buy.value = { channels: 1, categories: [] }; picked.value = null;
    const res = await api.get<{ items: TelroiNumber[] }>('/api/voice/numbers');
    numbers.value = res.items || [];
  } catch (e: any) {
    toast.err(e.message?.includes('insufficient') ? 'Wallet balance too low — top up first.' : e.message);
  } finally { buying.value = false; }
}

function routeLabel(n: TelroiNumber) {
  if (n.type === 'group') return n.group_name || 'Department';
  if (n.type === 'user') return n.user_name || 'Person';
  return n.type;
}

function edit(n: TelroiNumber) {
  // Map the number to its subscription (carrier-agnostic routing source of truth).
  const sub = subs.value.find((x: any) => x.telnum === n.telnum);
  if (!sub) { toast.err('This number has no active subscription to route.'); return; }
  editing.value = {
    id: sub.id,
    telnum: sub.telnum,
    routeType: sub.routeType || 'person',
    recordCalls: !!sub.recordCalls,
    recordOutbound: !!sub.recordOutbound,
    target: sub.routeTarget || '',
    departmentId: sub.departmentId || '',
    agentId: sub.routeAgentId || '',
    escalateTo: sub.routeEscalateMode === 'ring_all' ? '__all' : (sub.routeEscalateTo || ''),
    escalateAfter: sub.routeEscalateAfter || 0
  };
}

async function save() {
  if (!editing.value?.id) return;
  savingRoute.value = true;
  try {
    await api.post(`/api/numbers/${editing.value.id}/routing`, {
      routeType: editing.value.routeType,
      target: editing.value.target || undefined,
      departmentId: editing.value.departmentId || undefined,
      agentId: editing.value.agentId || undefined,
      escalateTo: editing.value.escalateTo || undefined,
      escalateAfter: editing.value.escalateAfter || 0,
      recordCalls: !!editing.value.recordCalls,
      recordOutbound: !!editing.value.recordOutbound
    });
    toast.ok('Routing saved');
    editing.value = null;
    await loadSubs();
  } catch (e: any) { toast.err(e?.data?.error?.message || e?.message || 'Could not save routing'); }
  finally { savingRoute.value = false; }
}

onMounted(async () => {
  try {
    const res = await api.get<{ items: TelroiNumber[] }>('/api/voice/numbers');
    numbers.value = res.items || [];
    try { channels.value = await api.get('/api/numbers/channels'); } catch { /* */ }
    await loadSubs();
    try { agents.value = await api.get<any[]>('/api/agents'); } catch { /* */ }
    try { departments.value = await api.get<any[]>('/api/departments'); } catch { /* */ }
    try { escalationTargets.value = (await api.get<{ targets: any[] }>('/api/voice/escalation-targets')).targets || []; } catch { /* */ }
    try {
      loadGoLive();
      const pr = await api.get<any>('/api/pricing');
      if (pr) {
        currencySym.value = pr.currency === 'NGN' ? '₦' : '$';
        const rate = pr.currency === 'NGN' ? (pr.ngnPerUsd || 1600) : 1;
        const conv = (usdMinor: number) => Math.round(usdMinor * rate) / 100;
        channelMonthly.value = conv(pr.channelMonthlyUsdMinor || 200);
        didMonthly.value = conv(pr.didMonthlyUsdMinor || 170);
        airtimePerMin.value = conv(pr.voiceMinuteUsdMinor ?? 1.02);
      }
    } catch { /* keep $2 default */ }
  } catch (e: any) { toast.err(e.message); }
  finally { pending.value = false; }
});
</script>

<style scoped>
.ind-modal { max-width: 780px; width: 94vw; padding: 28px 32px 24px; display: flex; flex-direction: column; max-height: 88vh; }
.ind-h { font-size: 20px; font-weight: 600; letter-spacing: -.01em; margin: 0 0 2px; }
.ind-sub { font-size: 12.5px; margin: 0 0 18px; }
.ind-body { height: 46vh; overflow-y: auto; font-size: 13.5px; line-height: 1.68; color: var(--ink);
  border: 1px solid var(--rule); border-radius: var(--radius); padding: 24px 28px; background: var(--paper-2); }
.ind-body :deep(h1) { font-size: 17px; font-weight: 600; margin: 0 0 14px; }
.ind-body :deep(h2) { font-size: 14px; font-weight: 600; margin: 26px 0 8px; padding-top: 18px;
  border-top: 1px solid var(--rule); }
.ind-body :deep(h2:first-of-type) { border-top: none; padding-top: 0; margin-top: 20px; }
.ind-body :deep(p) { margin: 0 0 12px; }
.ind-body :deep(ul) { margin: 0 0 14px; padding-left: 20px; }
.ind-body :deep(li) { margin-bottom: 7px; }
.ind-body :deep(strong) { font-weight: 600; color: var(--ink); }
.ind-body :deep(em) { color: var(--ink-soft); }
.ind-note { font-size: 12px; margin: 12px 0 0; }
.ind-actions { display: flex; gap: 10px; justify-content: flex-end; margin-top: 16px;
  padding-top: 16px; border-top: 1px solid var(--rule); }
.buy-steps { display: flex; gap: 6px; margin: 0 0 20px; padding-bottom: 16px; border-bottom: 1px solid var(--rule); }
.buy-step { display: flex; align-items: center; gap: 7px; flex: 1; font-size: 12px; color: var(--ink-mute); }
.buy-step-n { flex: none; width: 20px; height: 20px; border-radius: 50%; display: flex; align-items: center;
  justify-content: center; font-size: 11px; font-weight: 600; background: var(--paper-3); color: var(--ink-mute); }
.buy-step.on { color: var(--ink); font-weight: 600; }
.buy-step.on .buy-step-n { background: var(--signal); color: #fff; }
.buy-step.done .buy-step-n { background: rgba(0,210,138,.16); color: #0a8a5c; }
.buy-actions { display: flex; gap: 10px; justify-content: flex-end; margin-top: 20px;
  padding-top: 16px; border-top: 1px solid var(--rule); }
.buy-actions .btn { min-width: 130px; }
.buy-cats { margin: 14px 0; display: flex; flex-direction: column; gap: 2px; }
.buy-cats-h { font-size: 13px; font-weight: 600; margin-bottom: 8px; }
.buy-cat { display: flex; gap: 10px; align-items: flex-start; font-size: 12.5px; line-height: 1.55;
  color: var(--ink-soft); padding: 9px 12px; cursor: pointer; border: 1px solid transparent;
  border-radius: var(--radius); transition: background .12s, border-color .12s; }
.buy-cat:hover { background: var(--paper-2); }
.buy-cat:has(input:checked) { background: var(--paper-2); border-color: var(--rule); }
.buy-cat strong { color: var(--ink); font-weight: 600; }
.buy-cat input { margin-top: 3px; flex: none; }
.num-rec { display: flex; gap: 10px; align-items: flex-start; padding: 14px 16px; margin: 4px 0 16px; border: 1px solid var(--rule); border-radius: var(--radius); font-size: 13.5px; cursor: pointer; }
.num-rec-note { display: block; font-size: 12.5px; color: var(--ink-soft); line-height: 1.55; margin-top: 4px; }
.num-table { overflow: hidden; }
.num-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; }
.modal-overlay { position: fixed; inset: 0; z-index: 200; background: rgba(10,10,11,0.32); display: flex; align-items: center; justify-content: center; padding: 24px; }
.modal { width: 100%; max-width: 420px; background: var(--paper); }
.modal-x { color: var(--ink-mute); }
.buy-pricing { border: 1px solid var(--rule); border-radius: var(--radius); padding: 14px 16px; margin: 4px 0 18px; }
.buy-gate { border: 1px solid var(--rule); border-radius: var(--radius); padding: 16px; background: var(--paper-2); }
.buy-gate-h { font-size: 14px; font-weight: 500; margin: 0 0 6px; }
.buy-gate-p { font-size: 13px; color: var(--ink-soft); line-height: 1.6; margin: 0 0 12px; }
.buy-row { display: flex; justify-content: space-between; font-size: 13.5px; padding: 5px 0; }
.buy-total { border-top: 1px solid var(--rule-2); margin-top: 6px; padding-top: 10px; font-weight: 600; }
.buy-airtime { font-size: 12px; }
.buy-note { font-size: 12px; margin-top: 10px; text-align: center; }
.buy-empty { text-align: center; padding: 20px 0; font-size: 13.5px; }
.buy-pick-label { font-size: 13px; font-weight: 500; display: block; margin-bottom: 10px; }
.buy-list { display: flex; flex-direction: column; gap: 8px; max-height: 240px; overflow-y: auto; margin-bottom: 18px; }
.buy-pick { display: flex; align-items: center; justify-content: space-between; padding: 12px 14px; border: 1px solid var(--rule); border-radius: var(--radius); text-align: left; transition: all 0.12s; }
.buy-pick:hover { border-color: var(--signal-bright); }
.buy-pick.on { border-color: var(--signal); box-shadow: 0 0 0 3px var(--signal-soft); }
.buy-pick-num { font-size: 15px; font-weight: 500; }
.buy-pick-meta { display: flex; flex-direction: column; align-items: flex-end; gap: 2px; }
.buy-flag { font-size: 12.5px; }
.buy-prov { font-size: 11px; }
.buy-channels { margin-top: 4px; }
.num-cell { display: flex; align-items: center; gap: 8px; }
.main-chip { background: var(--signal-soft); color: var(--signal); border-color: rgba(26,75,114,0.2); font-size: 10.5px; }
.route-to { font-weight: 500; }
.loc { font-size: 12.5px; }
.row-actions { text-align: right; }
.loading-pad { padding: 16px 24px; display: flex; flex-direction: column; gap: 10px; }
.skel-row { height: 20px; }

.drawer-overlay { position: fixed; inset: 0; z-index: 150; background: rgba(10,10,11,0.28); display: flex; justify-content: flex-end; }
.drawer { width: 400px; max-width: 92vw; background: var(--paper); height: 100%; padding: 28px; box-shadow: var(--shadow-pop); }
.drawer-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
.drawer-sub { font-family: var(--font-mono); font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--ink-soft); }
.modal-x { color: var(--ink-mute); }
.drawer-num { font-family: var(--font-display); font-size: 26px; margin-bottom: 22px; }
.save-note { font-size: 12px; margin-top: 12px; }
.save-note code { font-family: var(--font-mono); background: var(--paper-2); padding: 1px 5px; border-radius: 4px; }

.drawer-enter-active, .drawer-leave-active { transition: opacity .2s; }
.drawer-enter-from, .drawer-leave-to { opacity: 0; }
.num-head-right { display: flex; align-items: center; gap: 12px; }
.channels-pill { display: inline-flex; align-items: center; gap: 7px; font-size: 12.5px; color: var(--ink-soft); background: var(--paper-2); border: 1px solid var(--rule); border-radius: 999px; padding: 6px 12px; }
.channels-pill .channels-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--live, #00d28a); }
.channels-pill.busy { color: var(--danger); border-color: var(--danger); }
.channels-pill.busy .channels-dot { background: var(--danger); }

.chan-card { margin-top: 18px; padding: 0; overflow: hidden; }
.chan-head { padding: 18px 18px 6px; }
.chan-title { font-size: 16px; font-weight: 650; margin: 0; }
.chan-sub { font-size: 13px; color: var(--ink-mute); margin: 4px 0 10px; max-width: 62ch; line-height: 1.5; }
.chan-drawer { max-width: 420px; }
.chan-quote { background: var(--paper-2); border: 1px solid var(--rule); border-radius: 12px; padding: 12px 14px; margin: 4px 0 16px; }
.chan-quote-row { display: flex; justify-content: space-between; gap: 12px; font-size: 13px; padding: 3px 0; }
.chan-fineprint { font-size: 11.5px; margin-top: 12px; line-height: 1.5; }

.num-release { color: var(--danger); }
.num-grace { font-size: 12px; color: var(--ink-mute); margin-right: 8px; }
</style>
