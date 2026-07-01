<template>
  <div>
    <div class="page-head bl-head">
      <div>
        <h1 class="page-title">Blacklist</h1>
        <p class="page-sub">Numbers blocked from reaching your team. Add ranges with a trailing <code>*</code>.</p>
      </div>
    </div>

    <!-- Anonymous toggle -->
    <div class="card anon card-pad">
      <div>
        <div class="anon-title">Block anonymous callers</div>
        <div class="muted anon-sub">Reject calls that hide their caller ID.</div>
      </div>
      <button class="toggle" :class="{ on: anon }" @click="anon = !anon" role="switch" :aria-checked="anon"><span class="knob" /></button>
    </div>

    <!-- Add -->
    <div class="card add-bl card-pad">
      <div class="add-grid">
        <input v-model="draft.telnum" class="input mono" placeholder="49301904198 or 4930190*" @keyup.enter="add" />
        <input v-model="draft.comment" class="input" placeholder="Reason (optional)" @keyup.enter="add" />
        <button class="btn btn-dark" :disabled="!draft.telnum" @click="add">Block</button>
      </div>
    </div>

    <!-- List -->
    <div class="card bl-table">
      <div v-if="pending" class="loading-pad"><div v-for="i in 3" :key="i" class="skeleton skel-row" /></div>
      <table v-else-if="entries.length" class="table">
        <thead><tr><th>Number / range</th><th>Reason</th><th>Blocked attempts</th><th></th></tr></thead>
        <tbody>
          <tr v-for="e in entries" :key="e.telnum">
            <td class="mono">{{ e.telnum }}</td>
            <td class="muted">{{ e.comment || '—' }}</td>
            <td class="mono">{{ (e.week || 0) + (e.year || 0) }}</td>
            <td class="row-actions"><button class="btn btn-danger btn-sm" @click="remove(e.telnum)">Remove</button></td>
          </tr>
        </tbody>
      </table>
      <EmptyState v-else icon="blacklist" title="Nothing blocked" description="Numbers you block will appear here." />
    </div>

    <!-- Recently blocked calls -->
    <div class="card blocked-log">
      <div class="blocked-head">
        <div class="blocked-title">Recently blocked</div>
        <div class="muted blocked-sub">Calls rejected by your blacklist or the anonymous-call block.</div>
      </div>
      <table v-if="blocked.length" class="table">
        <thead><tr><th>Caller</th><th>When</th></tr></thead>
        <tbody>
          <tr v-for="b in blocked" :key="b.callid">
            <td class="mono">
              <span v-if="b.anonymous" class="anon-tag">Anonymous</span>
              <template v-else>{{ b.phone }}</template>
            </td>
            <td class="muted">{{ b.at ? new Date(b.at).toLocaleString() : '\u2014' }}</td>
          </tr>
        </tbody>
      </table>
      <EmptyState v-else icon="blacklist" title="No blocked calls yet" description="Rejected calls will appear here." />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, watch, onMounted } from 'vue';
import type { TelroiBlacklistEntry } from '~/server/utils/telroi/client';

useHead({ title: 'Blacklist — Telroi' });
const api = useApi();
const toast = useToast();

const pending = ref(true);
const entries = ref<TelroiBlacklistEntry[]>([]);
const blocked = ref<Array<{ callid: string; phone: string | null; anonymous: boolean; at: string | null }>>([]);
const anon = ref(false);
const draft = reactive({ telnum: '', comment: '' });
let anonInit = false;

async function load() {
  pending.value = true;
  try {
    const res = await api.get<{ items: TelroiBlacklistEntry[] }>('/api/voice/blacklist');
    entries.value = res.items || [];
    try {
      const a = await api.get<{ state: boolean }>('/api/voice/block-anonymous');
      anon.value = !!a.state;
    } catch { /* leave default */ }
    try {
      const bc = await api.get<{ items: typeof blocked.value }>('/api/voice/blocked-calls');
      blocked.value = bc.items || [];
    } catch { /* non-fatal */ }
  } catch (e: any) { toast.err(e.message); }
  finally { pending.value = false; anonInit = true; }
}

// BUILD: add/remove/anon wire to POST/DELETE /api/voice/blacklist endpoints.
async function add() {
  try {
    await api.post('/api/voice/blacklist', { telnum: draft.telnum, comment: draft.comment });
    toast.ok('Number blocked');
    draft.telnum = ''; draft.comment = '';
    await load();
  } catch (e: any) { toast.err(e.message); }
}
async function remove(telnum: string) {
  try {
    await api.del('/api/voice/blacklist', { telnum });
    toast.ok('Removed');
    await load();
  } catch (e: any) { toast.err(e.message); }
}
watch(anon, async (v) => {
  if (!anonInit) return;
  try {
    await api.post('/api/voice/block-anonymous', { on: v });
    toast.ok(v ? 'Anonymous callers blocked' : 'Anonymous callers allowed');
  } catch (e: any) {
    toast.err(e.message);
    anon.value = !v;
  }
});

onMounted(load);
</script>

<style scoped>
.bl-head code { font-family: var(--font-mono); background: var(--paper-3); padding: 1px 5px; border-radius: 4px; }
.anon { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
.anon-title { font-weight: 500; font-size: 15px; }
.anon-sub { font-size: 13px; }
.blocked-log { margin-top: 18px; }
.blocked-head { padding: 16px 18px 4px; }
.blocked-title { font-weight: 500; font-size: 15px; }
.blocked-sub { font-size: 13px; }
.anon-tag { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 12px; background: var(--paper-2); color: var(--ink-soft); border: 1px solid var(--rule); }
.toggle { width: 46px; height: 27px; border-radius: 999px; background: var(--rule); position: relative; transition: background 0.18s; }
.toggle.on { background: var(--signal); }
.knob { position: absolute; top: 3px; left: 3px; width: 21px; height: 21px; background: var(--paper); border-radius: 50%; transition: transform 0.18s; box-shadow: 0 1px 3px rgba(0,0,0,0.2); }
.toggle.on .knob { transform: translateX(19px); }

.add-bl { margin-bottom: 16px; }
.add-grid { display: grid; grid-template-columns: 1fr 1fr auto; gap: 12px; }
.bl-table { overflow: hidden; }
.row-actions { text-align: right; }
.loading-pad { padding: 16px 24px; display: flex; flex-direction: column; gap: 10px; }
.skel-row { height: 20px; }
@media (max-width: 820px) { .add-grid { grid-template-columns: 1fr; } }
</style>
