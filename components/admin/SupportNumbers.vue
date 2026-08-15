<template>
  <div>

    <div v-if="pending" class="ad-loading">Loading...</div>
    <EmptyState v-else-if="!numbers.length" icon="calls" title="No numbers yet" description="Assign a number to the support workspace under Inventory." />
    <div v-else class="ad-table-wrap">
      <table class="ad-table">
        <thead><tr><th>Number</th><th>Carrier</th><th>Answered by</th><th>Handoff</th><th>Recording</th><th></th></tr></thead>
        <tbody>
          <tr v-for="n in numbers" :key="n.id">
            <td class="mono">{{ n.telnum }}</td>
            <td class="ad-dim">{{ n.provider }}</td>
            <td>{{ answeredBy(n) }}</td>
            <td class="ad-dim">{{ handoff(n) }}</td>
            <td><span class="nm-pill" :class="{ on: n.recordCalls }">{{ n.recordCalls ? 'Recording' : 'Off' }}</span></td>
            <td class="ad-r"><button class="btn btn-ghost btn-xs" @click="edit(n)">Edit</button></td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="editing" class="modal-overlay" @click.self="editing = null">
      <div class="modal card">
        <div class="card-head">
          <span class="card-title mono">{{ editing.telnum }}</span>
          <button class="modal-x" @click="editing = null">x</button>
        </div>
        <div class="card-pad">
          <label class="nm-field"><span>Answered by</span>
            <select v-model="editing.routeType" class="ad-input">
              <option value="ai">An AI agent</option>
              <option value="department">A team</option>
              <option value="ring_all">Anyone available</option>
              <option value="person">One person</option>
            </select>
          </label>

          <label v-if="editing.routeType === 'ai'" class="nm-field"><span>Which agent</span>
            <select v-model="editing.routeAgentId" class="ad-input">
              <option :value="null">- none -</option>
              <option v-for="a in agents" :key="a.id" :value="a.id">{{ a.name }}</option>
            </select>
          </label>

          <label v-if="editing.routeType === 'department'" class="nm-field"><span>Which team</span>
            <select v-model="editing.departmentId" class="ad-input">
              <option :value="null">- none -</option>
              <option v-for="d in departments" :key="d.id" :value="d.id">{{ d.name }}</option>
            </select>
          </label>

          <template v-if="editing.routeType === 'ai'">
            <label class="nm-field"><span>Hand off to</span>
              <select v-model="editing.escalateTo" class="ad-input">
                <option value="">- nobody, the AI handles it alone -</option>
                <option value="__all">Anyone available</option>
                <option v-for="t in targets" :key="t.id" :value="t.id">{{ t.label }}</option>
              </select>
            </label>
            <p class="ad-hint">Leaving this empty is what left the AI saying it would connect somebody and then having nowhere to send them.</p>
          </template>

          <label class="nm-check">
            <input type="checkbox" v-model="editing.recordCalls" />
            <span>
              <strong>Record calls on this number</strong>
              <span class="nm-note">Callers hear a notice before the call connects. Recordings are kept for the plan's period, and switching this off does not delete what is already recorded.</span>
            </span>
          </label>

          <button class="btn btn-signal btn-block" :disabled="saving" @click="save">{{ saving ? 'Saving...' : 'Save' }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';

const numbers = ref<any[]>([]);
const agents = ref<any[]>([]);
const departments = ref<any[]>([]);
const targets = ref<any[]>([]);
const pending = ref(true);
const editing = ref<any>(null);
const saving = ref(false);

function answeredBy(n: any) {
  if (n.routeType === 'ai') return agents.value.find((a) => a.id === n.routeAgentId)?.name || 'An AI agent';
  if (n.routeType === 'department') return departments.value.find((d) => d.id === n.departmentId)?.name || 'A team';
  if (n.routeType === 'ring_all') return 'Anyone available';
  return n.routeTarget || 'One person';
}

function handoff(n: any) {
  if (n.routeType !== 'ai') return '-';
  if (n.escalateMode === 'ring_all') return 'Anyone available';
  if (n.escalateMode === 'endpoint') return targets.value.find((t) => t.id === n.escalateTo)?.label || n.escalateTo || '-';
  return 'Nobody';
}

function edit(n: any) {
  editing.value = { ...n, escalateTo: n.escalateMode === 'ring_all' ? '__all' : (n.escalateTo || '') };
}

async function load() {
  pending.value = true;
  try {
    const r = await $fetch<any>('/api/admin/support/subscriptions');
    numbers.value = r.numbers || [];
    agents.value = r.agents || [];
    departments.value = r.departments || [];
    try { targets.value = (await $fetch<any>('/api/admin/support/escalation-targets'))?.targets || []; } catch { /* the rest still works */ }
  } catch (e: any) {
    if (e?.statusCode === 401) await navigateTo('/admin/login');
  } finally { pending.value = false; }
}

async function save() {
  saving.value = true;
  try {
    await $fetch(`/api/admin/support/subscriptions/${editing.value.id}`, {
      method: 'POST',
      body: {
        routeType: editing.value.routeType,
        agentId: editing.value.routeAgentId || null,
        departmentId: editing.value.departmentId || null,
        target: editing.value.routeTarget || null,
        escalateTo: editing.value.escalateTo || null,
        escalateAfter: editing.value.escalateAfter || 0,
        recordCalls: !!editing.value.recordCalls
      }
    });
    editing.value = null;
    await load();
  } catch (e: any) { alert(e?.data?.error?.message || 'Could not save'); }
  finally { saving.value = false; }
}

onMounted(load);
</script>

<style scoped>
/* Its own copy: inventory's styles are scoped, so a child component inherits
   none of them and the table rendered bare. */
.ad-table-wrap { background: var(--paper); border: 1px solid var(--rule); border-radius: var(--radius-lg); overflow: hidden; }
.ad-table { width: 100%; border-collapse: collapse; }
.ad-table th { text-align: left; font-family: var(--font-mono); font-size: 10.5px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink-mute); font-weight: 500; padding: 14px 16px; border-bottom: 1px solid var(--rule); }
.ad-table td { padding: 14px 16px; border-bottom: 1px solid var(--rule-2); color: var(--ink); font-size: 14px; }
.ad-table tr:last-child td { border-bottom: 0; }
.ad-r { text-align: right; }
.ad-dim { color: var(--ink-soft); }
.nm-field { display: flex; flex-direction: column; gap: 6px; margin-bottom: 16px; }
.nm-field > span { font-size: 12px; color: var(--ink-soft); font-weight: 500; }
.nm-field .ad-input { width: 100%; padding: 9px 12px; border: 1px solid var(--rule); border-radius: var(--radius); font-size: 14px; background: var(--paper); color: var(--ink); }
.nm-check { display: flex; gap: 10px; align-items: flex-start; padding: 14px 16px; margin: 4px 0 18px; border: 1px solid var(--rule); border-radius: var(--radius); font-size: 13.5px; cursor: pointer; }
.nm-note { display: block; font-size: 12.5px; color: var(--ink-soft); line-height: 1.55; margin-top: 4px; }
.nm-pill { font-size: 11.5px; padding: 2px 9px; border-radius: 999px; background: var(--paper-2); color: var(--ink-soft); }
.nm-pill.on { background: rgba(34,139,84,.12); color: #1c7a49; }
</style>
