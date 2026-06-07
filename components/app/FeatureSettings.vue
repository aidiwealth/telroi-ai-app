<template>
  <div class="fs">
    <div v-if="pending" class="fs-loading">Loading settings…</div>
    <template v-else>
      <div v-for="(meta, key) in visibleCatalog" :key="key" class="fs-row" :class="{ locked: locks.includes(key) }">
        <div class="fs-label">
          {{ meta.label }}
          <span v-if="locks.includes(key)" class="fs-lock" title="Locked by your provider" v-html="lockIcon" />
        </div>
        <div class="fs-control">
          <!-- bool -->
          <label v-if="meta.type === 'bool'" class="fs-switch">
            <input type="checkbox" :checked="model[key]" :disabled="locks.includes(key)" @change="set(key, $event.target.checked)" />
            <span class="fs-slider" />
          </label>
          <!-- color -->
          <input v-else-if="meta.type === 'color'" type="color" :value="model[key]" :disabled="locks.includes(key)" @change="set(key, $event.target.value)" class="fs-color" />
          <!-- select -->
          <select v-else-if="meta.type === 'select'" :value="model[key]" :disabled="locks.includes(key)" class="select fs-select" @change="set(key, $event.target.value)">
            <option v-for="o in optionsFor(key)" :key="o.value" :value="o.value">{{ o.label }}</option>
          </select>
          <!-- multi (checkbox list) -->
          <div v-else-if="meta.type === 'multi'" class="fs-multi">
            <label v-for="o in optionsFor(key)" :key="o.value" class="fs-multi-item">
              <input type="checkbox" :checked="(model[key]||[]).includes(o.value)" :disabled="locks.includes(key)" @change="toggleMulti(key, o.value, $event.target.checked)" /> {{ o.label }}
            </label>
          </div>
          <!-- text -->
          <input v-else type="text" :value="model[key]" :disabled="locks.includes(key)" class="input fs-text" @change="set(key, $event.target.value)" />
        </div>
      </div>
      <div class="fs-actions">
        <button class="btn btn-signal btn-sm" :disabled="saving || !dirty" @click="save">{{ saving ? 'Saving…' : 'Save settings' }}</button>
        <span v-if="locks.length" class="fs-note muted"><span v-html="lockIcon" /> settings are managed by your provider.</span>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue';
const lockIcon = '<svg viewBox=\'0 0 24 24\' width=\'12\' height=\'12\' fill=\'none\' stroke=\'currentColor\' stroke-width=\'1.8\' style=\'vertical-align:-1px\'><rect x=\'5\' y=\'11\' width=\'14\' height=\'9\' rx=\'2\'/><path d=\'M8 11V7a4 4 0 0 1 8 0v4\'/></svg>';
const props = defineProps<{ feature: string; admin?: boolean; endpoint?: string; routingEndpoint?: string }>();
const emit = defineEmits<{ saved: [model: Record<string, any>] }>();
const api = useApi();
const toast = useToast();

const catalog = ref<Record<string, any>>({});
// Business hours have their own dedicated tab/editor, so they're excluded from
// this auto-rendered list to avoid a duplicate control + an unrenderable
// 'hours' placeholder. Any future 'hours'-typed key is also hidden here.
const HIDDEN_KEYS = ['businessHoursEnabled', 'businessHours'];
const visibleCatalog = computed(() => {
  const out: Record<string, any> = {};
  for (const [k, meta] of Object.entries(catalog.value)) {
    if (HIDDEN_KEYS.includes(k)) continue;
    if ((meta as any)?.type === 'hours') continue;
    out[k] = meta;
  }
  return out;
});
const locks = ref<string[]>([]);
const model = reactive<Record<string, any>>({});
const teams = ref<any[]>([]);
const agents = ref<any[]>([]);
const pending = ref(true);
const saving = ref(false);
const dirty = ref(false);

const SELECT_OPTIONS: Record<string, { value: string; label: string }[]> = {
  defaultStatus: [ { value: 'lead', label: 'Lead' }, { value: 'active', label: 'Active' }, { value: 'customer', label: 'Customer' } ],
  bubblePosition: [ { value: 'middle-right', label: 'Middle right' }, { value: 'middle-left', label: 'Middle left' }, { value: 'bottom-right', label: 'Bottom right' }, { value: 'bottom-left', label: 'Bottom left' } ],
  routeTo: [ { value: 'agent', label: 'A live agent' }, { value: 'ai', label: 'AI agent' } ],
  callProvider: [ { value: 'auto', label: 'Automatic (recommended)' } ],
  allowedIntegrations: [ { value: 'zapier', label: 'Zapier' }, { value: 'pipedrive', label: 'Pipedrive' }, { value: 'hubspot', label: 'HubSpot' }, { value: 'zoho', label: 'Zoho CRM' } ]
};
function optionsFor(key: string) {
  if (key === 'routeTeamId') return [{ value: '', label: 'Any available member' }, ...teams.value.map((t: any) => ({ value: t.id, label: t.name }))];
  if (key === 'aiAgentId') return [{ value: '', label: 'Default AI agent' }, ...agents.value.map((a: any) => ({ value: a.id, label: a.name }))];
  if (key === 'callProvider') {
    // Vendor names are admin-only. Clients only ever see "Automatic" — they must
    // never be shown carrier/vendor names (Asterisk, Ruach, Sotel, etc.).
    if (!props.admin) return [{ value: 'auto', label: 'Automatic (recommended)' }];
    return [
      { value: 'auto', label: 'Automatic (recommended)' },
      { value: 'asterisk', label: 'Core Asterisk (global)' },
      { value: 'ruach', label: 'Ruach (Nigeria only)' },
      { value: 'sotel', label: 'Sotel (Nigeria only)' },
      { value: 'digidite', label: 'Digidite (Nigeria)' },
      { value: 'telnyx', label: 'Telnyx (international)' },
      { value: 'twilio', label: 'Twilio (international)' }
    ];
  }
  return SELECT_OPTIONS[key] || [];
}

let saveT: any = null;
function set(key: string, val: any) { model[key] = val; dirty.value = true; autosave(); }
function toggleMulti(key: string, val: string, on: boolean) {
  const arr = new Set(model[key] || []); on ? arr.add(val) : arr.delete(val); model[key] = [...arr]; dirty.value = true; autosave();
}
// Real-time save: persist shortly after a change, no need to click Save / refresh.
function autosave() { if (props.admin && !props.endpoint) return; clearTimeout(saveT); saveT = setTimeout(() => save(true), 500); }

async function load() {
  pending.value = true;
  try {
    const baseUrl = props.endpoint || (props.admin ? `/api/admin/feature-settings/${props.feature}` : `/api/feature-settings/${props.feature}`);
    const r = await api.get<any>(baseUrl);
    catalog.value = r.catalog; locks.value = r.locks || [];
    Object.assign(model, r.settings || {});
    // Live Call routing options (teams + AI agents) for the dynamic selects.
    if (props.feature === 'live_call' && (!props.admin || props.routingEndpoint)) {
      try { const ro = await api.get<any>(props.routingEndpoint || '/api/live-call/routing-options'); teams.value = ro.teams || []; agents.value = ro.agents || []; } catch { /* */ }
    }
  } catch (e: any) { toast.err(e?.data?.error?.message || 'Could not load settings'); }
  finally { pending.value = false; dirty.value = false; }
}
async function save(silent = false) {
  saving.value = true;
  try {
    const baseUrl = props.endpoint || (props.admin ? `/api/admin/feature-settings/${props.feature}` : `/api/feature-settings/${props.feature}`);
    const payload: any = { settings: { ...model } };
    if (props.admin) payload.locks = locks.value;
    const res = await api.put<any>(baseUrl, payload);
    dirty.value = false;
    if (res?.settings) Object.assign(model, res.settings); // reflect server-effective values immediately
    emit('saved', model);
    if (!silent) toast.ok('Settings saved');
  } catch (e: any) { toast.err(e?.data?.error?.message || 'Could not save'); }
  finally { saving.value = false; }
}
// Admin-only: toggle a lock on a setting key.
function toggleLock(key: string, on: boolean) {
  const arr = new Set(locks.value); on ? arr.add(key) : arr.delete(key); locks.value = [...arr]; dirty.value = true;
}
defineExpose({ toggleLock, locks });
onMounted(load);
</script>

<style scoped>
.fs-row { display: flex; justify-content: space-between; align-items: center; gap: 16px; padding: 13px 0; border-bottom: 1px solid var(--rule-2); }
.fs-row.locked { opacity: 0.8; }
.fs-label { font-size: 13.5px; display: flex; align-items: center; gap: 7px; }
.fs-lock { font-size: 11px; }
.fs-control { flex-shrink: 0; }
.fs-select, .fs-text { width: auto; min-width: 160px; }
.fs-color { width: 40px; height: 28px; border: 1px solid var(--rule); border-radius: 6px; padding: 2px; background: var(--paper); cursor: pointer; }
.fs-multi { display: flex; gap: 12px; flex-wrap: wrap; }
.fs-multi-item { font-size: 12.5px; display: flex; align-items: center; gap: 4px; }
.fs-switch { position: relative; display: inline-block; width: 38px; height: 22px; }
.fs-switch input { opacity: 0; width: 0; height: 0; }
.fs-slider { position: absolute; inset: 0; background: var(--rule-2); border-radius: 999px; transition: 0.2s; cursor: pointer; }
.fs-slider::before { content: ''; position: absolute; height: 16px; width: 16px; left: 3px; top: 3px; background: var(--paper); border-radius: 50%; transition: 0.2s; }
.fs-switch input:checked + .fs-slider { background: var(--signal); }
.fs-switch input:checked + .fs-slider::before { transform: translateX(16px); }
.fs-switch input:disabled + .fs-slider { opacity: 0.5; cursor: not-allowed; }
.fs-actions { display: flex; align-items: center; gap: 14px; margin-top: 16px; }
.fs-note { font-size: 12px; }
.fs-loading { padding: 20px; color: var(--ink-mute); font-size: 13px; }
</style>
