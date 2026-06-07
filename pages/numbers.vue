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
            <td class="row-actions"><button class="btn btn-ghost btn-sm" @click="openAdjust(sub)">Adjust</button></td>
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
            <div class="field-float">
              <input v-model="editing.escalateTo" class="input" placeholder=" " id="num-esc" />
              <label for="num-esc">Escalate to (person/department for human handoff)</label>
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
      <div class="modal card">
        <div class="card-head"><span class="card-title">Buy a number</span><button class="modal-x" @click="showBuy = false">✕</button></div>
        <div class="card-pad">
          <p v-if="!available.length" class="muted buy-empty">No numbers are available right now. Check back soon.</p>
          <template v-else>
            <label class="buy-pick-label">Choose a number</label>
            <div class="buy-list">
              <button v-for="a in available" :key="a.id" class="buy-pick" :class="{ on: picked?.id === a.id }" @click="picked = a">
                <span class="buy-pick-num mono">{{ a.telnum }}</span>
                <span class="buy-pick-meta">
                  <span class="buy-flag">{{ a.regionLabel }}</span>
                </span>
              </button>
            </div>

            <template v-if="picked">
              <div class="field buy-channels">
                <label>Voice channels</label>
                <input v-model.number="buy.channels" type="number" min="1" max="50" class="input mono" />
              </div>
              <div class="buy-pricing">
                <div class="buy-row"><span>Number (DID) · monthly</span><span class="mono">$1.70</span></div>
                <div class="buy-row"><span>{{ buy.channels }} channel{{ buy.channels > 1 ? 's' : '' }} · monthly</span><span class="mono">${{ (buy.channels * 2).toFixed(2) }}</span></div>
                <div class="buy-row buy-total"><span>Due now (first month)</span><span class="mono">${{ (1.7 + buy.channels * 2).toFixed(2) }}</span></div>
                <div class="buy-row buy-airtime muted"><span>Airtime</span><span>$0.0102 / min, billed per call</span></div>
              </div>
              <button class="btn btn-signal btn-block" :disabled="buying" @click="purchase">
                {{ buying ? 'Processing…' : 'Buy & charge wallet' }}
              </button>
              <p class="muted buy-note">Charged now, then monthly. A low balance blocks the purchase.</p>
            </template>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import type { TelroiNumber } from '~/server/utils/telroi/client';

useHead({ title: 'Numbers — Telroi' });
const api = useApi();
const toast = useToast();

const pending = ref(true);
const numbers = ref<TelroiNumber[]>([]);
const channels = ref<{ capacity: number; inUse: number; available: number } | null>(null);
const subs = ref<any[]>([]);
const channelMonthly = ref(2);          // USD per channel/month (display); refined from pricing
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
    subs.value = (await api.get<any[]>('/api/numbers/subscriptions')).filter((x: any) => x.status === 'active');
  } catch { subs.value = []; }
}
const editing = ref<any>(null);
const savingRoute = ref(false);
const agents = ref<any[]>([]);
const departments = ref<any[]>([]);
const showBuy = ref(false);
const buying = ref(false);
const available = ref<any[]>([]);
const picked = ref<any>(null);
const buy = ref({ channels: 1 });

async function openBuy() {
  showBuy.value = true; picked.value = null;
  try { const r = await api.get<any>('/api/numbers/available'); available.value = r.numbers || []; }
  catch (e: any) { toast.err(e.message); }
}

async function purchase() {
  if (!picked.value) return;
  buying.value = true;
  try {
    await api.post('/api/numbers/purchase', { inventoryId: picked.value.id, channels: buy.value.channels });
    toast.ok('Number purchased — wallet charged');
    showBuy.value = false;
    buy.value = { channels: 1 }; picked.value = null;
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
    target: sub.routeTarget || '',
    departmentId: sub.departmentId || '',
    agentId: sub.routeAgentId || '',
    escalateTo: sub.routeEscalateTo || '',
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
      escalateAfter: editing.value.escalateAfter || 0
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
    try {
      const pr = await api.get<any>('/api/pricing');
      if (pr) {
        currencySym.value = pr.currency === 'NGN' ? '₦' : '$';
        const perCh = pr.currency === 'NGN' ? Math.round((pr.channelMonthlyUsdMinor || 200) * (pr.ngnPerUsd || 1600)) : (pr.channelMonthlyUsdMinor || 200);
        channelMonthly.value = perCh / 100;
      }
    } catch { /* keep $2 default */ }
  } catch (e: any) { toast.err(e.message); }
  finally { pending.value = false; }
});
</script>

<style scoped>
.num-table { overflow: hidden; }
.num-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; }
.modal-overlay { position: fixed; inset: 0; z-index: 200; background: rgba(10,10,11,0.32); display: flex; align-items: center; justify-content: center; padding: 24px; }
.modal { width: 100%; max-width: 420px; background: var(--paper); }
.modal-x { color: var(--ink-mute); }
.buy-pricing { border: 1px solid var(--rule); border-radius: var(--radius); padding: 14px 16px; margin: 4px 0 18px; }
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

</style>
