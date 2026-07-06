<template>
  <div>
    <div class="page-head cn-head">
      <div>
        <h1 class="page-title">Connect</h1>
        <p class="page-sub">Build how calls flow — greetings, menus, routing and workflows. Publish to push the routing live to your PBX.</p>
      </div>
      <button class="btn btn-signal btn-sm" @click="createFlow">+ New flow</button>
    </div>

    <div class="cn-layout">
      <!-- Flow list -->
      <aside class="cn-list">
        <div v-if="pending" class="skeleton skel-row" />
        <button v-for="f in flows" :key="f.id" class="cn-list-item" :class="{ active: current?.id === f.id }" @click="select(f)">
          <span class="cn-list-name">{{ f.name }}</span>
          <span class="chip" :class="f.status === 'published' ? 'chip--ok' : ''">{{ f.status }}</span>
        </button>
        <p v-if="!pending && !flows.length" class="cn-empty-list muted">No flows yet.</p>
      </aside>

      <!-- Builder -->
      <section v-if="current" class="cn-builder card">
        <div class="cn-builder-head">
          <input v-model="current.name" class="cn-name-input" @blur="saveFlow" />
          <div class="cn-builder-actions">
            <select v-model="current.telnum" class="select cn-num-select" @change="saveFlow">
              <option :value="null">— Bind a number —</option>
              <option v-for="n in numbers" :key="n.telnum" :value="n.telnum">{{ n.telnum }}</option>
            </select>
            <button class="btn btn-signal btn-sm" :disabled="publishing || !current.telnum || !current.nodes.length" @click="publish">
              {{ publishing ? 'Publishing…' : 'Publish' }}
            </button>
          </div>
        </div>

        <!-- Nodes -->
        <!-- Step palette -->
        <div class="cn-palette">
          <span class="cn-palette-label">Drag a step into the flow, or click to add:</span>
          <div class="cn-palette-items">
            <button v-for="p in PALETTE" :key="p.type" class="cn-palette-chip" draggable="true"
                    @dragstart="onPaletteDragStart(p.type, $event)" @click="appendNode(p.type)">
              <span class="cn-chip-icon" v-html="nodeIcon(p.type)" />{{ p.label }}
            </button>
          </div>
        </div>

        <div class="cn-flow" @dragover.prevent @drop="onFlowDrop">
          <div class="cn-entry-label">Incoming call →</div>
          <p v-if="!current.nodes.length" class="cn-flow-empty muted">Drag a step here to start building the call flow.</p>
          <div v-for="(node, i) in current.nodes" :key="node.id"
               class="cn-node" :class="{ 'cn-node-dragover': dragOverIndex === i, 'cn-node-dragging': dragIndex === i }"
               draggable="true"
               @dragstart="onDragStart(i)" @dragover="onDragOver(i, $event)" @drop.stop="onDrop(i)" @dragend="dragOverIndex = null">
            <div class="cn-drag-handle" title="Drag to reorder">⋮⋮</div>
            <div class="cn-node-icon" :class="`nt-${node.type}`" v-html="nodeIcon(node.type)" />
            <div class="cn-node-body">
              <div class="cn-node-type">{{ nodeLabel(node.type) }} <span v-if="i === 0" class="cn-entry-pill">entry</span></div>
              <input v-model="node.config.target" v-if="['route_user','route_group','route_van'].includes(node.type)"
                     class="input cn-node-input" :placeholder="targetPlaceholder(node.type)" @blur="saveFlow" />
              <textarea v-if="node.type === 'route_van'" v-model="node.config.aiInstructions"
                        class="input cn-node-input cn-ai-instr" rows="2"
                        placeholder="Optional: how the AI should handle this call (e.g. verify the caller's account, then offer billing or support)" @blur="saveFlow"></textarea>
              <input v-model="node.config.text" v-if="['greeting','voicemail'].includes(node.type)"
                     class="input cn-node-input" placeholder="What the caller hears" @blur="saveFlow" />
              <div v-if="node.type === 'menu'" class="cn-menu-opts">
                <input v-model="node.config.text" class="input cn-node-input" placeholder="Menu prompt (e.g. Press 1 for sales, 2 for support)" @blur="saveFlow" />
                <div v-for="(opt, oi) in (node.config.options || [])" :key="oi" class="cn-menu-opt">
                  <input v-model="opt.digit" class="input cn-digit-input mono" placeholder="1" @blur="saveFlow" />
                  <input v-model="opt.label" class="input cn-node-input" placeholder="e.g. Sales" @blur="saveFlow" />
                </div>
                <button class="cn-add-opt" @click="addMenuOption(node)">+ Add option</button>
              </div>
            </div>
            <button class="cn-node-del" @click="removeNode(i)" title="Remove step">✕</button>
          </div>
        </div>

        <!-- Workflows -->
        <div class="cn-workflows">
          <div class="cn-section-label">Workflows <span class="muted">— fire on call events</span></div>
          <div v-for="(wf, i) in current.workflows" :key="wf.id" class="cn-wf">
            <select v-model="wf.trigger" class="select cn-wf-sel" @change="saveFlow">
              <option value="call_answered">When answered</option>
              <option value="call_missed">When missed</option>
              <option value="call_ended">When ended</option>
              <option value="rating_received">On rating</option>
            </select>
            <span class="cn-wf-arrow">→</span>
            <select v-model="wf.action" class="select cn-wf-sel" @change="saveFlow">
              <option value="crm_write">Write to CRM</option>
              <option value="webhook">Call webhook</option>
            </select>
            <button class="cn-node-del" @click="removeWorkflow(i)">✕</button>
          </div>
          <button class="cn-add-opt" @click="addWorkflow">+ Add workflow</button>
        </div>
      </section>

      <section v-else class="cn-builder card">
        <EmptyState icon="flows" title="Select or create a flow" description="Connect turns a number into a call-handling flow: greet, route, escalate, and trigger workflows." />
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';

useHead({ title: 'Connect — Telroi' });
const api = useApi();
const toast = useToast();

const pending = ref(true);
const flows = ref<any[]>([]);
const current = ref<any>(null);
const numbers = ref<any[]>([]);
const newNodeType = ref('greeting');
const publishing = ref(false);
const dragIndex = ref<number | null>(null);
const dragOverIndex = ref<number | null>(null);

// Palette of step types (drag onto the flow, or click to append).
const PALETTE = [
  { type: 'greeting', label: 'Greeting' },
  { type: 'menu', label: 'Menu (IVR)' },
  { type: 'route_user', label: 'Route to person' },
  { type: 'route_group', label: 'Route to department' },
  { type: 'route_van', label: 'Route to AI' },
  { type: 'voicemail', label: 'Voicemail' },
  { type: 'hangup', label: 'Hang up' }
];

function makeNode(type: string) {
  const id = Math.random().toString(36).slice(2, 9);
  const config: any = type === 'menu' ? { options: [] } : {};
  return { id, type, config };
}
function appendNode(type: string) {
  if (!current.value) return;
  current.value.nodes.push(makeNode(type));
  saveFlow();
}
// Reorder within the flow.
function onDragStart(i: number) { dragIndex.value = i; }
function onDragOver(i: number, e: DragEvent) { e.preventDefault(); dragOverIndex.value = i; }
function onDrop(i: number) {
  const from = dragIndex.value;
  if (from === null || from === i) { dragIndex.value = null; dragOverIndex.value = null; return; }
  const nodes = current.value.nodes;
  const [moved] = nodes.splice(from, 1);
  nodes.splice(i, 0, moved);
  dragIndex.value = null; dragOverIndex.value = null;
  saveFlow();
}
// Drop a palette item onto the flow.
function onPaletteDragStart(type: string, e: DragEvent) { e.dataTransfer?.setData('text/palette', type); }
function onFlowDrop(e: DragEvent) {
  const type = e.dataTransfer?.getData('text/palette');
  if (type) { appendNode(type); }
}

function nodeLabel(t: string) {
  return ({ greeting: 'Greeting', menu: 'Menu (IVR)', route_user: 'Route to person', route_group: 'Route to department', route_van: 'Route to AI Number', voicemail: 'Voicemail', hangup: 'Hang up' } as any)[t] || t;
}
function nodeIcon(t: string) {
  const s = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">';
  const icons: Record<string, string> = {
    greeting: s + '<path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg>',
    menu: s + '<path d="M3 6h18M3 12h18M3 18h18"/></svg>',
    route_user: s + '<circle cx="12" cy="8" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0"/></svg>',
    route_group: s + '<circle cx="9" cy="8" r="3"/><path d="M2.5 19a6.5 6.5 0 0 1 13 0"/><path d="M16 5.5a3 3 0 0 1 0 5.5M18 19a6 6 0 0 0-3.2-5.3"/></svg>',
    route_van: s + '<rect x="4" y="7" width="16" height="12" rx="2.5"/><path d="M12 7V4M8.5 12h.01M15.5 12h.01M9 16h6"/></svg>',
    voicemail: s + '<circle cx="6.5" cy="14" r="3.5"/><circle cx="17.5" cy="14" r="3.5"/><path d="M6.5 17.5h11"/></svg>',
    hangup: s + '<rect x="4" y="4" width="16" height="16" rx="2"/></svg>'
  };
  return icons[t] || (s + '<circle cx="12" cy="12" r="2.5"/></svg>');
}
function targetPlaceholder(t: string) {
  return t === 'route_user' ? 'extension or username' : t === 'route_group' ? 'department id' : 'VAN id';
}

async function load() {
  pending.value = true;
  try {
    const [f, n] = await Promise.all([
      api.get<any[]>('/api/connect'),
      api.get<{ items: any[] }>('/api/voice/numbers').catch(() => ({ items: [] }))
    ]);
    flows.value = f;
    numbers.value = n.items || [];
    if (f.length && !current.value) select(f[0]);
  } catch (e: any) { toast.err(e.message); }
  finally { pending.value = false; }
}

function select(f: any) {
  current.value = JSON.parse(JSON.stringify({ ...f, nodes: f.nodes || [], workflows: f.workflows || [] }));
}

async function createFlow() {
  try {
    const f = await api.post<any>('/api/connect', { name: 'New flow', nodes: [], workflows: [] });
    await load();
    select(f);
  } catch (e: any) { toast.err(e.message); }
}

let saveTimer: any;
async function saveFlow() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    if (!current.value) return;
    try {
      await api.put(`/api/connect/${current.value.id}`, {
        name: current.value.name, telnum: current.value.telnum,
        nodes: current.value.nodes, workflows: current.value.workflows
      });
      const idx = flows.value.findIndex((x) => x.id === current.value.id);
      if (idx >= 0) flows.value[idx] = { ...flows.value[idx], ...current.value };
    } catch (e: any) { toast.err(e.message); }
  }, 500);
}

function addNode() {
  const id = Math.random().toString(36).slice(2, 9);
  const cfg: any = newNodeType.value === 'menu' ? { options: [] } : {};
  current.value.nodes.push({ id, type: newNodeType.value, config: cfg });
  saveFlow();
}
function removeNode(i: number) { current.value.nodes.splice(i, 1); saveFlow(); }
function addMenuOption(node: any) {
  node.config.options = node.config.options || [];
  node.config.options.push({ digit: String(node.config.options.length + 1), label: '' });
  saveFlow();
}
function addWorkflow() {
  current.value.workflows.push({ id: Math.random().toString(36).slice(2, 9), trigger: 'call_missed', action: 'crm_write', config: {} });
  saveFlow();
}
function removeWorkflow(i: number) { current.value.workflows.splice(i, 1); saveFlow(); }

async function publish() {
  publishing.value = true;
  try {
    await api.post(`/api/connect/${current.value.id}/publish`);
    toast.ok('Published — routing is live on your PBX');
    await load();
  } catch (e: any) { toast.err(e.message); }
  finally { publishing.value = false; }
}

onMounted(load);
</script>

<style scoped>
.cn-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; }
.cn-layout { display: grid; grid-template-columns: 240px 1fr; gap: 18px; }
.cn-list { display: flex; flex-direction: column; gap: 6px; }
.cn-list-item { display: flex; align-items: center; justify-content: space-between; padding: 12px 14px; background: var(--paper); border: 1px solid var(--rule); border-radius: var(--radius); transition: border-color 0.14s; text-align: left; }
.cn-list-item:hover { border-color: var(--signal-bright); }
.cn-list-item.active { border-color: var(--signal); box-shadow: 0 0 0 3px var(--signal-soft); }
.cn-list-name { font-size: 13.5px; font-weight: 500; }
.cn-empty-list { font-size: 13px; padding: 8px; }

.cn-builder { padding: 24px; }
.cn-builder-head { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 24px; padding-bottom: 18px; border-bottom: 1px solid var(--rule); }
.cn-name-input { font-family: var(--font-display); font-size: 22px; border: none; outline: none; flex: 1; letter-spacing: -0.01em; }
.cn-builder-actions { display: flex; gap: 10px; align-items: center; }
.cn-num-select { width: 180px; }

.cn-flow { display: flex; flex-direction: column; gap: 0; }
.cn-entry-label { font-family: var(--font-mono); font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--signal); margin-bottom: 14px; }
.cn-node { display: flex; gap: 14px; align-items: flex-start; padding: 14px; border: 1px solid var(--rule); border-radius: var(--radius); background: var(--paper); margin-bottom: 8px; position: relative; }
.cn-node-icon { width: 36px; height: 36px; border-radius: var(--radius-sm); display: flex; align-items: center; justify-content: center; font-size: 16px; background: var(--signal-soft); flex-shrink: 0; }
.cn-node-body { flex: 1; }
.cn-node-type { font-size: 13.5px; font-weight: 500; margin-bottom: 6px; display: flex; align-items: center; gap: 8px; }
.cn-entry-pill { font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--signal); background: var(--signal-soft); padding: 2px 7px; border-radius: 999px; }
.cn-node-input { font-size: 13.5px; }
.cn-node-del { color: var(--ink-mute); font-size: 13px; flex-shrink: 0; }
.cn-node-del:hover { color: var(--danger); }
.cn-menu-opts { display: flex; flex-direction: column; gap: 8px; margin-top: 8px; }
.cn-menu-opt { display: flex; align-items: center; gap: 10px; }
.cn-digit { width: 28px; height: 28px; border-radius: var(--radius-sm); background: var(--paper-3); display: flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 600; flex-shrink: 0; }
.cn-add-opt { font-size: 12.5px; color: var(--signal); align-self: flex-start; }
.cn-add-node { display: flex; gap: 10px; margin-top: 8px; }
.cn-add-select { width: 220px; }

.cn-palette { margin-bottom: 16px; padding: 14px 16px; background: var(--paper-2); border: 1px solid var(--rule-2); border-radius: 12px; }
.cn-palette-label { font-size: 12.5px; color: var(--ink-soft); display: block; margin-bottom: 10px; }
.cn-palette-items { display: flex; flex-wrap: wrap; gap: 8px; }
.cn-palette-chip { display: inline-flex; align-items: center; gap: 6px; padding: 8px 12px; border: 1px solid var(--rule-2); border-radius: 9px; background: var(--paper); font-size: 13px; cursor: grab; color: var(--ink); }
.cn-palette-chip:hover { border-color: var(--signal); color: var(--signal); }
.cn-palette-chip:active { cursor: grabbing; }
.cn-chip-icon { display: inline-flex; }
.cn-flow-empty { text-align: center; padding: 24px; border: 1.5px dashed var(--rule-2); border-radius: 10px; font-size: 13px; }
.cn-drag-handle { cursor: grab; color: var(--ink-mute); font-size: 13px; letter-spacing: -2px; padding: 0 4px; user-select: none; }
.cn-drag-handle:active { cursor: grabbing; }
.cn-node-dragging { opacity: 0.5; }
.cn-node-dragover { border-color: var(--signal); box-shadow: 0 -2px 0 var(--signal); }
.cn-ai-instr { resize: vertical; min-height: 42px; font-family: inherit; }
.cn-digit-input { width: 48px; text-align: center; flex: none; }
.cn-workflows { margin-top: 28px; padding-top: 22px; border-top: 1px solid var(--rule); }
.cn-section-label { font-size: 14px; font-weight: 500; margin-bottom: 14px; }
.cn-wf { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
.cn-wf-sel { width: auto; flex: 1; }
.cn-wf-arrow { color: var(--ink-mute); }

@media (max-width: 820px) { .cn-layout { grid-template-columns: 1fr; } }
</style>
