<template>
  <div class="bh">
    <label class="bh-toggle">
      <span class="fs-switch"><input type="checkbox" :checked="enabled" @change="setEnabled($event.target.checked)" /><span class="fs-slider" /></span>
      <span>Only show the widget during business hours</span>
    </label>
    <p class="bh-sub">Outside these hours the call button is hidden. Times use the selected timezone.</p>

    <div class="bh-tz">
      <label>Timezone</label>
      <select :value="hours.tz" class="select" :disabled="!enabled" @change="setTz($event.target.value)">
        <option v-for="t in tzList" :key="t" :value="t">{{ t }}</option>
      </select>
    </div>

    <div class="bh-days">
      <div v-for="d in dayKeys" :key="d.key" class="bh-day" :class="{ off: !hours.days[d.key] }">
        <label class="bh-day-toggle">
          <input type="checkbox" :checked="!!hours.days[d.key]" :disabled="!enabled" @change="toggleDay(d.key, $event.target.checked)" />
          <span class="bh-day-name">{{ d.label }}</span>
        </label>
        <template v-if="hours.days[d.key]">
          <input type="time" :value="hours.days[d.key][0]" :disabled="!enabled" class="bh-time" @change="setTime(d.key, 0, $event.target.value)" />
          <span class="bh-dash">–</span>
          <input type="time" :value="hours.days[d.key][1]" :disabled="!enabled" class="bh-time" @change="setTime(d.key, 1, $event.target.value)" />
        </template>
        <span v-else class="bh-closed">Closed</span>
      </div>
    </div>

    <button class="btn btn-signal btn-sm bh-save" :disabled="saving" @click="save">{{ saving ? 'Saving…' : 'Save business hours' }}</button>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue';
const props = defineProps<{ admin?: boolean; domain?: string; endpoint?: string }>();
const api = useApi();
const toast = useToast();
const dayKeys = [
  { key: 'mon', label: 'Monday' }, { key: 'tue', label: 'Tuesday' }, { key: 'wed', label: 'Wednesday' },
  { key: 'thu', label: 'Thursday' }, { key: 'fri', label: 'Friday' }, { key: 'sat', label: 'Saturday' }, { key: 'sun', label: 'Sunday' }
];
const tzList = ['UTC', 'Africa/Lagos', 'Europe/London', 'Europe/Berlin', 'America/New_York', 'America/Los_Angeles', 'Asia/Dubai', 'Asia/Singapore'];
const enabled = ref(false);
const hours = reactive<any>({ tz: 'UTC', days: { mon: ['09:00','17:00'], tue: ['09:00','17:00'], wed: ['09:00','17:00'], thu: ['09:00','17:00'], fri: ['09:00','17:00'], sat: null, sun: null } });
const saving = ref(false);

function base() {
  if (props.endpoint) return props.endpoint;
  if (props.admin && props.domain) return `/api/admin/clients/${encodeURIComponent(props.domain)}/feature-settings/live_call`;
  if (props.admin) return '/api/admin/feature-settings/live_call';
  return '/api/feature-settings/live_call';
}
function setEnabled(v: boolean) { enabled.value = v; }
function setTz(v: string) { hours.tz = v; }
function toggleDay(k: string, on: boolean) { hours.days[k] = on ? ['09:00','17:00'] : null; }
function setTime(k: string, i: number, v: string) { if (hours.days[k]) hours.days[k][i] = v; }

async function load() {
  try {
    const r = await api.get<any>(base());
    enabled.value = !!r.settings?.businessHoursEnabled;
    if (r.settings?.businessHours) Object.assign(hours, r.settings.businessHours);
  } catch { /* */ }
}
async function save() {
  saving.value = true;
  try {
    const payload: any = { settings: { businessHoursEnabled: enabled.value, businessHours: { tz: hours.tz, days: hours.days } } };
    await api.put(base(), payload);
    toast.ok('Business hours saved');
  } catch (e: any) { toast.err(e?.data?.error?.message || 'Could not save'); }
  finally { saving.value = false; }
}
onMounted(load);
</script>

<style scoped>
.bh-toggle { display: flex; align-items: center; gap: 10px; font-size: 14px; font-weight: 500; }
.bh-sub { font-size: 12.5px; color: var(--ink-soft); margin: 6px 0 16px; }
.bh-tz { margin-bottom: 16px; max-width: 320px; }
.bh-tz label { display: block; font-size: 12px; color: var(--ink-soft); margin-bottom: 5px; }
.bh-days { display: flex; flex-direction: column; gap: 8px; margin-bottom: 18px; }
.bh-day { display: flex; align-items: center; gap: 12px; padding: 8px 0; border-bottom: 1px solid var(--rule-2); }
.bh-day.off { opacity: 0.65; }
.bh-day-toggle { display: flex; align-items: center; gap: 8px; width: 150px; }
.bh-day-name { font-size: 13.5px; }
.bh-time { padding: 6px 9px; border: 1px solid var(--rule); border-radius: 8px; font-size: 13px; }
.bh-dash { color: var(--ink-mute); }
.bh-closed { font-size: 12.5px; color: var(--ink-mute); }
.fs-switch { position: relative; display: inline-block; width: 38px; height: 22px; }
.fs-switch input { opacity: 0; width: 0; height: 0; }
.fs-slider { position: absolute; inset: 0; background: var(--rule-2); border-radius: 999px; cursor: pointer; transition: .2s; }
.fs-slider::before { content: ''; position: absolute; height: 16px; width: 16px; left: 3px; top: 3px; background: var(--paper); border-radius: 50%; transition: .2s; }
.fs-switch input:checked + .fs-slider { background: var(--signal); }
.fs-switch input:checked + .fs-slider::before { transform: translateX(16px); }
</style>
