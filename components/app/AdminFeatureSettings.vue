<template>
  <div class="afs">
    <div class="afs-tabs">
      <button v-for="f in features" :key="f.key" class="afs-tab" :class="{ on: feature === f.key }" @click="feature = f.key">{{ f.label }}</button>
    </div>
    <div v-if="pending" class="afs-loading">Loading…</div>
    <template v-else>
      <p class="afs-lede muted">Set the defaults clients start with, and lock any setting so clients can’t change it. Locked settings appear read-only to clients.</p>
      <div class="afs-head"><span>Setting</span><span>{{ domain ? 'Value' : 'Default' }}</span><span v-if="!domain" class="afs-lockcol">Lock</span></div>
      <div v-for="(meta, key) in visibleCatalog" :key="key" class="afs-row" :class="{ 'afs-row-nolock': domain }">
        <div class="afs-label">{{ meta.label }}</div>
        <div class="afs-control">
          <label v-if="meta.type === 'bool'" class="afs-switch"><input type="checkbox" :checked="model[key]" @change="set(key, $event.target.checked)" /><span class="afs-slider" /></label>
          <input v-else-if="meta.type === 'color'" type="color" :value="model[key]" class="afs-color" @change="set(key, $event.target.value)" />
          <select v-else-if="meta.type === 'select'" :value="model[key]" class="select afs-select" @change="set(key, $event.target.value)"><option v-for="o in optionsFor(key)" :key="o.value" :value="o.value">{{ o.label }}</option></select>
          <div v-else-if="meta.type === 'multi'" class="afs-multi"><label v-for="o in optionsFor(key)" :key="o.value"><input type="checkbox" :checked="(model[key]||[]).includes(o.value)" @change="toggleMulti(key, o.value, $event.target.checked)" /> {{ o.label }}</label></div>
          <input v-else type="text" :value="model[key]" class="input afs-text" @change="set(key, $event.target.value)" />
        </div>
        <div v-if="!domain" class="afs-lockcol"><input type="checkbox" :checked="locks.includes(key)" @change="toggleLock(key, $event.target.checked)" /></div>
      </div>
      <div class="afs-actions"><button class="btn btn-signal btn-sm" :disabled="saving || !dirty" @click="save">{{ saving ? 'Saving…' : (domain ? 'Save for this client' : 'Save platform defaults') }}</button><span v-if="saved" class="ad-saved">✓ Saved</span></div>

      <!-- Live Call visual preview -->
      <div v-if="feature === 'live_call'" class="afs-preview-wrap">
        <div class="afs-preview-label">Preview</div>
        <div class="afs-preview" :class="model.bubblePosition || 'middle-right'">
          <div class="afs-pv-panel">
            <div class="afs-pv-head2">
              <div class="afs-pv-status"><span class="afs-pv-dot"></span>We're online now</div>
            </div>
            <div class="afs-pv-body">
              <div class="afs-pv-orb" :style="{ '--oc': model.bubbleColor }">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13 1 .35 1.94.65 2.84a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.3 1.84.52 2.84.65A2 2 0 0 1 22 16.92z"/></svg>
              </div>
              <div class="afs-pv-h2">{{ model.greeting || 'Call our team' }}</div>
              <div class="afs-pv-lead">Enter your details — we'll ring you back in seconds.</div>
              <div class="afs-pv-row">
                <div class="afs-pv-pill">Name</div>
                <div class="afs-pv-pill">Number</div>
              </div>
              <div class="afs-pv-btn2" :style="{ background: model.bubbleColor }">Request call →</div>
              <div class="afs-pv-route">Routes to {{ model.routeTo === 'ai' ? 'AI agent' : 'a live agent' }}<template v-if="model.csatEnabled"> · rating after</template></div>
            </div>
          </div>
          <div class="afs-pv-bubble" :style="{ background: model.bubbleColor }">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#fff" stroke-width="2"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2 4.2 2 2 0 0 1 4 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.6a2 2 0 0 1-.5 2.1L8.1 9.6a16 16 0 0 0 6 6l1.2-1.1a2 2 0 0 1 2.1-.5c.8.3 1.7.6 2.6.7a2 2 0 0 1 1.7 2z"/></svg>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
<script setup lang="ts">
import { ref, reactive, watch, computed, onMounted } from 'vue';
const props = defineProps<{ domain?: string }>();
const features = [ { key: 'crm', label: 'CRM' }, { key: 'live_call', label: 'Live Call' }, { key: 'apps', label: 'Apps & Integrations' } ];
const feature = ref('crm');
const catalog = ref<Record<string, any>>({});
const HIDDEN_KEYS = ['businessHoursEnabled', 'businessHours'];
const visibleCatalog = computed(() => { const out = {}; for (const [k, meta] of Object.entries(catalog.value)) { if (HIDDEN_KEYS.includes(k)) continue; if (meta?.type === 'hours') continue; out[k] = meta; } return out; });
const locks = ref<string[]>([]);
const model = reactive<Record<string, any>>({});
const pending = ref(true); const saving = ref(false); const saved = ref(false); const dirty = ref(false);

const SELECT_OPTIONS: Record<string, { value: string; label: string }[]> = {
  defaultStatus: [ { value: 'lead', label: 'Lead' }, { value: 'active', label: 'Active' }, { value: 'customer', label: 'Customer' } ],
  bubblePosition: [ { value: 'middle-right', label: 'Middle right' }, { value: 'middle-left', label: 'Middle left' }, { value: 'bottom-right', label: 'Bottom right' }, { value: 'bottom-left', label: 'Bottom left' } ],
  routeTo: [ { value: 'agent', label: 'A live agent' }, { value: 'ai', label: 'AI agent' } ],
  callProvider: [ { value: 'auto', label: 'Automatic (Nigeria → Telroi Voice, others → Telnyx/Twilio)' }, { value: 'digidite', label: 'Digidite' }, { value: 'telnyx', label: 'Telnyx' }, { value: 'twilio', label: 'Twilio' } ],
  allowedIntegrations: [ { value: 'zapier', label: 'Zapier' }, { value: 'pipedrive', label: 'Pipedrive' }, { value: 'hubspot', label: 'HubSpot' }, { value: 'zoho', label: 'Zoho CRM' } ]
};
function optionsFor(k: string) { return SELECT_OPTIONS[k] || []; }
function set(k: string, v: any) { model[k] = v; dirty.value = true; }
function toggleMulti(k: string, v: string, on: boolean) { const a = new Set(model[k] || []); on ? a.add(v) : a.delete(v); model[k] = [...a]; dirty.value = true; }
function toggleLock(k: string, on: boolean) { const a = new Set(locks.value); on ? a.add(k) : a.delete(k); locks.value = [...a]; dirty.value = true; }

function urlBase() {
  return props.domain
    ? `/api/admin/clients/${encodeURIComponent(props.domain)}/feature-settings/${feature.value}`
    : `/api/admin/feature-settings/${feature.value}`;
}
async function load() {
  pending.value = true;
  try {
    const r = await $fetch<any>(urlBase());
    catalog.value = r.catalog; locks.value = r.locks || [];
    Object.keys(model).forEach((k) => delete model[k]);
    Object.assign(model, r.settings || {});
  } catch (e) { /* */ } finally { pending.value = false; dirty.value = false; saved.value = false; }
}
async function save() {
  saving.value = true;
  try {
    const body: any = { settings: { ...model } };
    if (!props.domain) body.locks = locks.value;   // locks only at platform scope
    await $fetch(urlBase(), { method: 'PUT', body }); saved.value = true; dirty.value = false;
  }
  catch (e: any) { alert(e?.data?.error?.message || 'Save failed'); } finally { saving.value = false; }
}
watch(feature, load);
onMounted(load);
</script>
<style scoped>
.afs-tabs { display: flex; gap: 4px; margin-bottom: 16px; }
.afs-tab { padding: 7px 14px; font-size: 13px; color: var(--ink-soft); border: 1px solid var(--rule); border-radius: 999px; }
.afs-tab.on { background: var(--signal-soft); color: var(--signal); border-color: var(--signal); }
.afs-lede { font-size: 12.5px; margin-bottom: 14px; line-height: 1.5; }
.afs-head { display: grid; grid-template-columns: 1fr auto 48px; gap: 16px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--ink-mute); padding-bottom: 8px; border-bottom: 1px solid var(--rule); }
.afs-row-nolock { grid-template-columns: 1fr auto !important; }
.afs-row { display: grid; grid-template-columns: 1fr auto 48px; gap: 16px; align-items: center; padding: 12px 0; border-bottom: 1px solid var(--rule-2); }
.afs-label { font-size: 13.5px; }
.afs-lockcol { text-align: center; }
.afs-select, .afs-text { width: auto; min-width: 150px; }
.afs-color { width: 40px; height: 28px; border: 1px solid var(--rule); border-radius: 6px; background: var(--paper); }
.afs-multi { display: flex; gap: 10px; flex-wrap: wrap; font-size: 12px; }
.afs-switch { position: relative; display: inline-block; width: 38px; height: 22px; }
.afs-switch input { opacity: 0; width: 0; height: 0; }
.afs-slider { position: absolute; inset: 0; background: var(--rule-2); border-radius: 999px; cursor: pointer; transition: 0.2s; }
.afs-slider::before { content: ''; position: absolute; height: 16px; width: 16px; left: 3px; top: 3px; background: var(--paper); border-radius: 50%; transition: 0.2s; }
.afs-switch input:checked + .afs-slider { background: var(--signal); }
.afs-switch input:checked + .afs-slider::before { transform: translateX(16px); }
.afs-actions { display: flex; align-items: center; gap: 12px; margin-top: 16px; }
.afs-loading { padding: 18px; color: var(--ink-mute); }
</style>
<style scoped>
.afs-preview-wrap { margin-top: 22px; border-top: 1px solid var(--rule); padding-top: 16px; }
.afs-preview-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--ink-mute); margin-bottom: 10px; }
.afs-preview { position: relative; height: 300px; background: var(--paper-2); border: 1px dashed var(--rule-2); border-radius: 12px; }
.afs-pv-bubble { position: absolute; bottom: 16px; right: 16px; width: 52px; height: 52px; border-radius: 50%; display: flex; align-items: center; justify-content: center; box-shadow: 0 6px 18px rgba(0,0,0,.16); }
.afs-pv-head2 { padding: 12px 14px 2px; }
.afs-pv-orb { position: relative; width: 66px; height: 66px; margin: 6px auto 10px; border-radius: 50%; background: color-mix(in srgb, var(--oc) 10%, transparent); display: flex; align-items: center; justify-content: center; }
.afs-pv-orb::before { content: ''; position: absolute; inset: 8px; border-radius: 50%; background: color-mix(in srgb, var(--oc) 16%, transparent); }
.afs-pv-orb svg { position: relative; z-index: 1; width: 34px; height: 34px; padding: 7px; border-radius: 50%; background: var(--oc); box-sizing: border-box; }
.afs-pv-h2 { text-align: center; font-size: 14px; font-weight: 600; color: #1a1a1a; }
.afs-pv-row { display: flex; gap: 6px; margin: 8px 0; }
.afs-pv-pill { flex: 1; padding: 8px 9px; border-radius: 9px; background: #f5f4f0; color: #a8a49c; font-size: 11px; text-align: center; }
.afs-pv-btn2 { padding: 10px; border-radius: 999px; color: #fff; font-size: 12.5px; font-weight: 600; text-align: center; }
.afs-pv-panel { position: absolute; bottom: 78px; right: 16px; width: 248px; background: #fff; border-radius: 14px; box-shadow: 0 12px 32px rgba(0,0,0,.16); overflow: hidden; }
.afs-preview.bottom-left .afs-pv-bubble, .afs-preview.bottom-left .afs-pv-panel { left: 16px; right: auto; }
.afs-preview.middle-right .afs-pv-bubble { bottom: auto; top: 50%; right: 0; transform: translateY(-50%); width: 44px; height: auto; padding: 11px 9px; border-radius: 12px 0 0 12px; }
.afs-preview.middle-right .afs-pv-panel { bottom: auto; top: 50%; right: 56px; transform: translateY(-50%); }
.afs-preview.middle-left .afs-pv-bubble { bottom: auto; top: 50%; left: 0; right: auto; transform: translateY(-50%); width: 44px; height: auto; padding: 11px 9px; border-radius: 0 12px 12px 0; }
.afs-preview.middle-left .afs-pv-panel { bottom: auto; top: 50%; left: 56px; right: auto; transform: translateY(-50%); }
.afs-pv-head { display: flex; align-items: center; gap: 9px; padding: 14px 14px 12px; background: #f7f6f3; border-bottom: 1px solid #ececec; }
.afs-pv-icon { flex: none; width: 34px; height: 34px; border-radius: 50%; background: #fff; color: #9a9690; display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 6px rgba(10,10,11,.08); border: 1px solid #ececec; }
.afs-pv-htext { flex: 1; min-width: 0; }
.afs-pv-title { font-size: 13.5px; font-weight: 650; color: var(--ink); letter-spacing: -.01em; line-height: 1.2; }
.afs-pv-status { display: flex; align-items: center; gap: 5px; margin-top: 2px; font-size: 11px; color: #8a8780; }
.afs-pv-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--live, #00d28a); box-shadow: 0 0 0 3px rgba(0,210,138,.16); }
.afs-pv-body { padding: 14px 15px; }
.afs-pv-lead { font-size: 11.5px; color: #6b6862; line-height: 1.5; margin-bottom: 11px;  text-align: center; }
.afs-pv-input { border: 1px solid #e4e1da; border-radius: 9px; padding: 9px 11px; margin-bottom: 8px; font-size: 12.5px; color: #aaa; background: #faf9f6; }
.afs-pv-btn { border-radius: 9px; padding: 10px; text-align: center; color: #fff; font-size: 13px; font-weight: 600; box-shadow: 0 5px 14px rgba(26,75,114,.24); }
.afs-pv-route { font-size: 11px; color: #888; text-align: center; margin-top: 8px; }
</style>
