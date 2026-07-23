<template>
  <header class="topbar">
    <button class="tb-menu" @click="$emit('toggleSidebar')" aria-label="Toggle menu">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 6h18M3 12h18M3 18h18"/></svg>
    </button>

    <!-- Workspace switcher -->
    <div class="tb-ws" v-if="auth.tenant" @click="wsOpen = !wsOpen" v-click-outside="() => wsOpen = false">
      <div class="tb-ws-dot" />
      <div class="tb-ws-text">
        <span class="tb-ws-name">{{ auth.tenant.name }}</span>
      </div>
      <svg class="tb-ws-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="6 9 12 15 18 9"/></svg>
      <Transition name="pop">
        <div v-if="wsOpen" class="tb-ws-pop">
          <div class="tb-ws-pop-label">Workspace</div>
          <div class="tb-ws-pop-item active">
            <div class="tb-ws-dot" /> {{ auth.tenant.name }}
          </div>
        </div>
      </Transition>
    </div>

    <!-- Breadcrumb -->
    <nav class="tb-crumbs" v-if="crumbs.length">
      <template v-for="(c, i) in crumbs" :key="i">
        <span class="tb-crumb-sep" v-if="i > 0">›</span>
        <NuxtLink v-if="c.to" :to="c.to" class="tb-crumb">{{ c.label }}</NuxtLink>
        <span v-else class="tb-crumb tb-crumb-current">{{ c.label }}</span>
      </template>
    </nav>

    <div class="tb-right">
      <!-- Environment: a status pill (where you are) + an action button (what
           tapping does). Best practice — the control is labelled by its action,
           not its current state, so it's self-explanatory. -->
      <div class="tb-env-group">
        <span class="tb-env-status" :class="env" :title="`You are in ${env === 'live' ? 'Live' : 'Sandbox'} mode`">
          <span class="tb-env-dot" />
          {{ env === 'live' ? 'Live' : 'Sandbox' }}
        </span>
        <button class="tb-env-action" :class="env" @click="onEnvClick" :disabled="envBusy"
          :title="env === 'live' ? 'Return to sandbox (no real charges)' : 'Activate live mode'">
          {{ env === 'live' ? 'Switch to sandbox' : 'Go live' }}
        </button>
      </div>

      <button class="btn btn-ghost btn-sm" @click="dialerOpen = true" data-tour="topbar-dialer">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" stroke="none"><circle cx="5" cy="5" r="1.6"/><circle cx="12" cy="5" r="1.6"/><circle cx="19" cy="5" r="1.6"/><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/><circle cx="5" cy="19" r="1.6"/><circle cx="12" cy="19" r="1.6"/><circle cx="19" cy="19" r="1.6"/></svg>
        Dialer
      </button>

      <div class="tb-acct" @click="menuOpen = !menuOpen" v-click-outside="() => menuOpen = false" data-tour="topbar-help">
        <div class="tb-avatar">{{ initials }}</div>
        <Transition name="pop">
          <div v-if="menuOpen" class="tb-menu-pop">
            <div class="tb-menu-head">
              <div class="tb-avatar tb-avatar-sm">{{ initials }}</div>
              <div class="tb-menu-id">
                <div class="tb-menu-name">{{ displayName }}</div>
                <div class="tb-menu-email">{{ auth.user?.email }}</div>
              </div>
            </div>
            <div class="tb-menu-divider" />
            <NuxtLink to="/settings" class="tb-menu-item">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="8" r="3.2"/><path d="M5 20v-1a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v1"/></svg>
              Profile
            </NuxtLink>
            <button class="tb-menu-item" @click.stop="startTour">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01" stroke-linecap="round"/></svg>
              Take a tour
            </button>
            <button class="tb-menu-item" @click.stop="toggleDark">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>
              {{ dark ? 'Lights on' : 'Lights off' }}
            </button>
            <div class="tb-menu-divider" />
            <button class="tb-menu-item" @click="auth.logout()">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
              Logout
            </button>
          </div>
        </Transition>
      </div>
    </div>

    <!-- Compliance gate modal (shown when going live without approval) -->
    <div v-if="showCompliance" class="modal-overlay" @click.self="showCompliance = false">
      <div class="modal card cmp-modal">
        <div class="card-head"><span class="card-title">Activate live mode</span><button class="modal-x" @click="showCompliance = false">✕</button></div>
        <div class="card-pad">
          <div v-if="sbx" class="cmp-quota">
            <div class="cmp-quota-row">
              <span>Test calls</span>
              <strong :class="{ spent: sbx.callsExhausted }">{{ sbx.callsUsed }} / {{ sbx.callCap }}</strong>
            </div>
            <div class="cmp-quota-row">
              <span>AI numbers</span>
              <strong :class="{ spent: sbx.agentsExhausted }">{{ sbx.agentsUsed }} / {{ sbx.agentCap }}</strong>
            </div>
            <p v-if="sbx.callsExhausted || sbx.agentsExhausted" class="cmp-quota-note">
              You've used your sandbox allowance. Going live removes these limits and starts real billing.
            </p>
          </div>
          <p class="cmp-lede" v-if="complianceStatus === 'pending'">Your documents are under review. You'll be able to switch to live once approved.</p>
          <template v-else>
            <p class="cmp-lede">Going live requires business verification. Upload your documents to request live access.</p>
            <div class="field-float">
              <input v-model="cmp.officialName" class="input" placeholder=" " id="cmp-name" />
              <label for="cmp-name">Official company name</label>
            </div>
            <div class="field">
              <label class="cmp-file-label">Business license <span class="cmp-req">required</span></label>
              <label class="cmp-drop" :class="{ filled: businessFile }">
                <input type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" class="cmp-file-input" @change="onBusinessFile" />
                <span v-if="!businessFile" class="cmp-drop-text">Click to upload — PDF, PNG or JPG (max 5MB)</span>
                <span v-else class="cmp-drop-file">📄 {{ businessFile.name }}</span>
              </label>
            </div>
            <div class="field">
              <label class="cmp-file-label">Regulatory license <span v-if="regRequired" class="cmp-req">required</span><span v-else class="cmp-opt">optional</span></label>
              <label class="cmp-drop" :class="{ filled: regulatoryFile }">
                <input type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" class="cmp-file-input" @change="onRegulatoryFile" />
                <span v-if="!regulatoryFile" class="cmp-drop-text">{{ regRequired ? 'Required for Nigerian businesses (e.g. NCC license)' : 'e.g. NCC / telecom license — PDF, PNG or JPG' }}</span>
                <span v-else class="cmp-drop-file">📄 {{ regulatoryFile.name }}</span>
              </label>
            </div>
            <button class="btn btn-signal btn-block" :disabled="submitting || !cmp.officialName || !businessFile || (regRequired && !regulatoryFile)" @click="submitCompliance">
              {{ submitting ? 'Uploading…' : 'Submit for review' }}
            </button>
            <p class="cmp-note muted">An operator reviews submissions before live access is granted. Your documents are stored securely and only accessed for verification.</p>
          </template>
        </div>
      </div>
    </div>

    <DialerModal v-if="dialerOpen" @close="dialerOpen = false" />
  </header>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { CLIENT_TOUR_ID, clientTour } from '~/composables/tourSteps';
import { useAuthStore } from '~/stores/auth';

defineEmits<{ toggleSidebar: [] }>();

const auth = useAuthStore();
const route = useRoute();
const rootDomain = useRuntimeConfig().public.rootDomain;
const menuOpen = ref(false);
const { start: startTourEngine } = useTour();
const router = useRouter();
function startTour() {
  menuOpen.value = false;
  startTourEngine(CLIENT_TOUR_ID, clientTour, (r) => router.push(r));
}
const wsOpen = ref(false);
const dialerOpen = ref(false);
const env = ref<'live' | 'sandbox'>('sandbox');
const envBusy = ref(false);
const sbx = ref<any | null>(null);

// Other parts of the app (e.g. hitting a sandbox limit) can ask us to open the
// go-live flow rather than duplicating it.
onMounted(() => {
  if (!import.meta.client) return;
  window.addEventListener('telroi-open-go-live', () => { void onEnvClick(); });
});
onMounted(() => {
  if (import.meta.client) {
    const saved = localStorage.getItem('telroi_env');
    if (saved === 'live' || saved === 'sandbox') env.value = saved;
    // Server state is authoritative — reflect the workspace's real sandbox flag.
    if (auth.tenant && typeof auth.tenant.sandbox === 'boolean') {
      env.value = auth.tenant.sandbox ? 'sandbox' : 'live';
      localStorage.setItem('telroi_env', env.value);
    }
    if (localStorage.getItem('telroi_theme') === 'dark') {
      dark.value = true;
      document.documentElement.classList.add('dark');
    }
  }
});

const initials = computed(() => (auth.user?.email || '?').slice(0, 2).toUpperCase());
const displayName = computed(() => {
  const e = auth.user?.email || '';
  const name = e.split('@')[0].replace(/[._]/g, ' ');
  return name.replace(/\b\w/g, (c) => c.toUpperCase()) || 'Account';
});

// Dark-mode toggle ("Lights off"). Remaps the design tokens via a `.dark` class
// on <html>; the whole app reads those tokens, so the theme applies globally.
// The choice is persisted and restored on mount.
const dark = ref(false);
function toggleDark() {
  dark.value = !dark.value;
  if (import.meta.client) {
    document.documentElement.classList.toggle('dark', dark.value);
    localStorage.setItem('telroi_theme', dark.value ? 'dark' : 'light');
  }
}

// Derive breadcrumb from the route path. Maps known segments to labels.
const LABELS: Record<string, string> = {
  '': 'Overview', wallet: 'Wallet', calls: 'Calls', numbers: 'Numbers',
  connect: 'Connect', providers: 'Carriers', blacklist: 'Blacklist',
  vans: 'AI Numbers', ai: 'AI Connections', optimize: 'Optimize',
  agents: 'Agents', groups: 'Departments', developers: 'Developers', settings: 'Settings'
};
const crumbs = computed(() => {
  const segs = route.path.split('/').filter(Boolean);
  if (!segs.length) return [{ label: 'Overview', to: null }];
  const out: { label: string; to: string | null }[] = [];
  let path = '';
  segs.forEach((seg, i) => {
    path += '/' + seg;
    const label = LABELS[seg] || seg.charAt(0).toUpperCase() + seg.slice(1);
    out.push({ label, to: i < segs.length - 1 ? path : null });
  });
  return out;
});

const showCompliance = ref(false);
const complianceStatus = ref<string | null>(null);
const submitting = ref(false);
const cmp = ref({ officialName: '' });
const businessFile = ref<File | null>(null);
const regulatoryFile = ref<File | null>(null);
const regRequired = ref(false); // true for Nigerian accounts

function onBusinessFile(e: Event) { businessFile.value = (e.target as HTMLInputElement).files?.[0] || null; }
function onRegulatoryFile(e: Event) { regulatoryFile.value = (e.target as HTMLInputElement).files?.[0] || null; }

async function onEnvClick() {
  if (envBusy.value) return;
  // Live -> Sandbox is safe and immediate (no real charges in sandbox).
  if (env.value === 'live') { await setEnv('sandbox'); return; }
  // Sandbox -> Live is the consequential direction: open the go-live modal.
  // Nigerian accounts must also provide a regulatory license.
  regRequired.value = (auth.tenant?.country || '').toLowerCase() === 'nigeria';
  try {
    const r = await $fetch<{ compliance: any }>('/api/compliance');
    complianceStatus.value = r.compliance?.status || null;
    // Where they stand on the sandbox allowance — makes the reason to go live
    // concrete rather than abstract.
    try { sbx.value = (await $fetch<any>('/api/go-live'))?.sandbox || null; } catch { sbx.value = null; }
    if (r.compliance?.status === 'approved') { await setEnv('live'); return; }
    // Not approved — open the gate.
    showCompliance.value = true;
  } catch {
    showCompliance.value = true;
  }
}
async function setEnv(next: 'live' | 'sandbox') {
  const prev = env.value;
  envBusy.value = true;
  env.value = next;
  if (import.meta.client) {
    localStorage.setItem('telroi_env', next);
    window.dispatchEvent(new CustomEvent('telroi-env-change', { detail: next }));
  }
  // Persist to the server so the mode is actually enforced on money/provider
  // actions (not just a local label). Roll back the UI if the server rejects.
  try {
    await $fetch('/api/tenant/sandbox', { method: 'POST', body: { sandbox: next === 'sandbox' } });
    if (auth.tenant) auth.tenant.sandbox = next === 'sandbox';
  } catch (e: any) {
    env.value = prev;
    if (import.meta.client) localStorage.setItem('telroi_env', prev);
    alert(e?.data?.error?.message || 'Could not change mode.');
  } finally {
    envBusy.value = false;
  }
}
async function submitCompliance() {
  if (!businessFile.value) { alert('A business license document is required'); return; }
  if (regRequired.value && !regulatoryFile.value) { alert('A regulatory license is required for Nigerian businesses'); return; }
  submitting.value = true;
  try {
    const fd = new FormData();
    fd.append('officialName', cmp.value.officialName);
    fd.append('businessLicense', businessFile.value);
    if (regulatoryFile.value) fd.append('regulatoryLicense', regulatoryFile.value);
    await $fetch('/api/compliance', { method: 'POST', body: fd });
    complianceStatus.value = 'pending';
  } catch (e: any) {
    alert(e?.data?.error?.message || e?.data?.message || 'Submission failed');
  } finally { submitting.value = false; }
}

const vClickOutside = {
  mounted(el: any, binding: any) {
    el.__handler = (e: Event) => { if (!el.contains(e.target)) binding.value(); };
    setTimeout(() => document.addEventListener('click', el.__handler));
  },
  unmounted(el: any) { document.removeEventListener('click', el.__handler); }
};
</script>

<style scoped>
.topbar {
  height: var(--topbar-h); border-bottom: 1px solid var(--rule);
  background: var(--paper);
  display: flex; align-items: center; gap: 14px; padding: 0 20px;
  position: sticky; top: 0; z-index: 40;
}
.tb-menu { display: none; color: var(--ink-soft); }
.tb-menu svg { width: 22px; height: 22px; }

/* Workspace switcher */
.tb-ws { display: flex; align-items: center; gap: 9px; padding: 6px 10px; border-radius: var(--radius-sm); cursor: pointer; position: relative; transition: background 0.12s; }
.tb-ws:hover { background: var(--paper-2); }
.tb-ws-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--signal); flex-shrink: 0; }
.tb-ws-name { font-weight: 500; font-size: 14px; white-space: nowrap; }
.tb-ws-caret { width: 14px; height: 14px; color: var(--ink-mute); }
.tb-ws-pop { position: absolute; left: 0; top: calc(100% + 8px); background: var(--paper); border: 1px solid var(--rule); border-radius: var(--radius); box-shadow: var(--shadow-pop); min-width: 240px; padding: 8px; }
.tb-ws-pop-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--ink-mute); padding: 4px 10px 8px; }
.tb-ws-pop-item { display: flex; align-items: center; gap: 9px; padding: 9px 10px; border-radius: var(--radius-sm); font-size: 13.5px; }
.tb-ws-pop-item.active { background: var(--paper-2); }
.tb-ws-slug { margin-left: auto; font-size: 11px; color: var(--ink-mute); }

/* Breadcrumb */
.tb-crumbs { display: flex; align-items: center; gap: 8px; padding-left: 6px; border-left: 1px solid var(--rule); margin-left: 2px; padding-left: 16px; }
.tb-crumb { font-size: 13.5px; color: var(--ink-soft); transition: color 0.12s; }
.tb-crumb:hover { color: var(--ink); }
.tb-crumb-current { color: var(--ink); font-weight: 500; }
.tb-crumb-sep { color: var(--ink-mute); font-size: 13px; }

.tb-right { margin-left: auto; display: flex; align-items: center; gap: 12px; }

/* Environment badge */
.tb-env-group { display: inline-flex; align-items: center; gap: 8px; }
.tb-env-status { display: inline-flex; align-items: center; gap: 6px; padding: 5px 11px; border-radius: 999px; font-size: 12px; font-weight: 600; border: 1px solid var(--rule); }
.tb-env-dot { width: 7px; height: 7px; border-radius: 50%; }
.tb-env-status.sandbox { color: var(--warn); border-color: rgba(183,121,31,0.35); background: rgba(183,121,31,0.08); }
.tb-env-status.sandbox .tb-env-dot { background: var(--warn); }
.tb-env-status.live { color: #0a8a5c; border-color: rgba(0,210,138,0.4); background: rgba(0,210,138,0.1); }
.tb-env-status.live .tb-env-dot { background: var(--live); }
/* Action button — labelled by what tapping does. In sandbox it's a prominent
   "Go live" call-to-action; in live it's a quieter "Switch to sandbox". */
.tb-env-action { padding: 6px 13px; border-radius: 999px; font-size: 12.5px; font-weight: 600; transition: all 0.12s; border: 1px solid transparent; }
.tb-env-action:disabled { opacity: 0.6; cursor: default; }
.tb-env-action.sandbox { color: #fff; background: var(--live); }
.tb-env-action.sandbox:hover:not(:disabled) { background: #0a8a5c; }
.tb-env-action.live { color: var(--ink-soft); background: transparent; border-color: var(--rule); }
.tb-env-action.live:hover:not(:disabled) { color: var(--ink); border-color: var(--ink-soft); }

.tb-acct { position: relative; cursor: pointer; }
.tb-avatar { width: 34px; height: 34px; border-radius: 50%; background: var(--signal); color: #fff; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 600; }
.tb-avatar-sm { width: 36px; height: 36px; font-size: 13px; flex-shrink: 0; }
.tb-menu-pop { position: absolute; right: 0; top: calc(100% + 10px); background: var(--paper); border: 1px solid var(--rule); border-radius: var(--radius); box-shadow: var(--shadow-pop); min-width: 240px; padding: 6px; }
.tb-menu-head { display: flex; align-items: center; gap: 11px; padding: 10px 10px 12px; }
.tb-menu-id { min-width: 0; }
.tb-menu-name { font-size: 14px; font-weight: 500; }
.tb-menu-email { font-size: 12.5px; color: var(--ink-mute); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tb-menu-divider { height: 1px; background: var(--rule-2); margin: 4px 0; }
.tb-menu-item { display: flex; align-items: center; gap: 11px; width: 100%; text-align: left; padding: 9px 12px; border-radius: var(--radius-sm); font-size: 13.5px; color: var(--ink); transition: background 0.12s; }
.tb-menu-item:hover { background: var(--paper-2); }
.tb-menu-item svg { width: 17px; height: 17px; color: var(--ink-soft); }

.pop-enter-active, .pop-leave-active { transition: opacity .15s, transform .15s; }
.pop-enter-from, .pop-leave-to { opacity: 0; transform: translateY(-6px); }

.modal-overlay { position: fixed; inset: 0; z-index: 200; background: rgba(10,10,11,0.32); display: flex; align-items: center; justify-content: center; padding: 24px; }
.modal { width: 100%; max-width: 460px; background: var(--paper); }
.modal-x { color: var(--ink-mute); }
.cmp-lede { font-size: 13.5px; color: var(--ink-soft); margin-bottom: 18px; line-height: 1.5; }
.cmp-quota { border: 1px solid var(--line); border-radius: 10px; padding: 12px 14px; margin-bottom: 16px; }
.cmp-quota-row { display: flex; justify-content: space-between; align-items: baseline; font-size: 13px; color: var(--ink-soft); padding: 3px 0; }
.cmp-quota-row strong { font-size: 13.5px; color: var(--ink); font-variant-numeric: tabular-nums; }
.cmp-quota-row strong.spent { color: var(--danger, #d1435b); }
.cmp-quota-note { font-size: 12px; color: var(--ink-soft); margin: 8px 0 0; line-height: 1.5; }
.cmp-file-label { font-size: 13px; font-weight: 500; display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.cmp-req { font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--danger); background: rgba(192,57,43,0.08); padding: 1px 6px; border-radius: 999px; font-weight: 600; }
.cmp-opt { font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--ink-mute); background: var(--paper-3); padding: 1px 6px; border-radius: 999px; font-weight: 500; }
.cmp-drop { display: block; border: 1.5px dashed var(--rule); border-radius: var(--radius); padding: 16px; text-align: center; cursor: pointer; transition: border-color 0.14s, background 0.14s; }
.cmp-drop:hover { border-color: var(--signal-bright); background: var(--signal-soft); }
.cmp-drop.filled { border-style: solid; border-color: var(--signal); background: var(--signal-soft); }
.cmp-file-input { display: none; }
.cmp-drop-text { font-size: 12.5px; color: var(--ink-mute); }
.cmp-drop-file { font-size: 13px; color: var(--signal-2); font-weight: 500; word-break: break-all; }
.cmp-note { font-size: 12px; margin-top: 12px; line-height: 1.5; }

@media (max-width: 820px) { .tb-menu { display: block; } .tb-crumbs { display: none; } .tb-env-status { display: none; } }
</style>
