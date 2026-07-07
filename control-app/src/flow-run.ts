// control-app/src/flow-run.ts
// Executes a published Connect flow over ARI: plays greeting/menu prompts (TTS),
// gathers a DTMF digit for menus, and branches. Returns a TERMINAL action for the
// bridge to carry out (AI agent / person / department / hangup) — the flow runner
// handles the IVR steps, the bridge handles the connect. Keeps all the existing
// bridging logic untouched.
import type * as Ari from 'ari-client';
import { synthesizeMessage } from './bridge.ts';

type Logger = (msg: string) => void;

export interface FlowTerminal {
  kind: 'ai' | 'person' | 'department' | 'hangup';
  target?: string | null;       // agentId / extension / departmentId
}

interface FlowNode { id: string; type: string; config?: any; }

// Play a TTS message (or a fallback sound) and wait for it to finish.
async function playMessage(client: Ari.Client, channel: Ari.Channel, text: string, tenantId: string, agentId: string | undefined, log: Logger): Promise<void> {
  let media = 'sound:beep';
  try {
    const synth = await synthesizeMessage(text, tenantId, agentId).catch(() => null);
    if (synth) media = synth;
  } catch { /* fall back to beep */ }
  await new Promise<void>((resolve) => {
    try {
      const playback = client.Playback();
      channel.play({ media }, playback).catch(() => resolve());
      playback.once('PlaybackFinished', () => resolve());
      // Safety timeout so a stuck playback can't hang the call.
      setTimeout(() => resolve(), 20000);
    } catch { resolve(); }
  });
}

// Gather a single DTMF digit within a timeout. Returns the digit or null.
// ari-client emits ChannelDtmfReceived on the CLIENT (with the channel in the
// event payload), so we listen there and filter by channel id.
async function gatherDigit(client: Ari.Client, channel: Ari.Channel, timeoutMs: number, log: Logger): Promise<string | null> {
  return await new Promise<string | null>((resolve) => {
    let done = false;
    const onDtmf = (event: any, evChannel: any) => {
      if (done) return;
      const cid = evChannel?.id || event?.channel?.id;
      if (cid && cid !== channel.id) return;  // not our channel
      done = true;
      client.removeListener('ChannelDtmfReceived', onDtmf);
      log(`[flow] dtmf received: ${event?.digit}`);
      resolve(event?.digit ?? null);
    };
    client.on('ChannelDtmfReceived', onDtmf);
    setTimeout(() => {
      if (done) return;
      done = true;
      client.removeListener('ChannelDtmfReceived', onDtmf);
      resolve(null);
    }, timeoutMs);
  });
}

function nodeToTerminal(node: FlowNode): FlowTerminal {
  switch (node.type) {
    case 'route_van': return { kind: 'ai', target: node.config?.target || null };
    case 'route_user': return { kind: 'person', target: node.config?.target || null };
    case 'route_group': return { kind: 'department', target: node.config?.target || null };
    case 'voicemail':
    case 'hangup': return { kind: 'hangup' };
    default: return { kind: 'hangup' };
  }
}

// Run the flow. Returns the terminal action the bridge should perform.
export async function runFlow(
  client: Ari.Client, channel: Ari.Channel, nodes: FlowNode[], tenantId: string, agentIdHint: string | undefined, log: Logger
): Promise<FlowTerminal> {
  if (!Array.isArray(nodes) || !nodes.length) return { kind: 'hangup' };
  let idx = 0;
  let guard = 0;  // prevent infinite loops
  while (idx < nodes.length && guard < 25) {
    guard++;
    const node = nodes[idx];
    if (!node) break;

    if (node.type === 'greeting') {
      const text = node.config?.text || '';
      if (text) { log(`[flow] greeting: "${text.slice(0, 60)}"`); await playMessage(client, channel, text, tenantId, agentIdHint, log); }
      idx++;
      continue;
    }

    if (node.type === 'menu') {
      const prompt = node.config?.text || node.config?.prompt || 'Please make a selection.';
      const options: any[] = node.config?.options || [];
      log(`[flow] menu: ${options.length} option(s)`);
      // Play the prompt, then gather one digit; retry once on no-input.
      let chosen: any = null;
      for (let attempt = 0; attempt < 2 && !chosen; attempt++) {
        await playMessage(client, channel, prompt, tenantId, agentIdHint, log);
        const digit = await gatherDigit(client, channel, 6000, log);
        if (digit) {
          chosen = options.find((o) => String(o.digit ?? o.key ?? '') === String(digit));
          if (!chosen) log(`[flow] no option for digit ${digit}`);
        }
      }
      if (chosen && chosen.target) {
        // If the option specifies a routeKind, it's a direct terminal destination.
        if (chosen.routeKind === 'ai') return { kind: 'ai', target: chosen.target };
        if (chosen.routeKind === 'group') return { kind: 'department', target: chosen.target };
        if (chosen.routeKind === 'user') return { kind: 'person', target: chosen.target };
        // Otherwise the target may be another node id -> jump there.
        const tIdx = nodes.findIndex((n) => n.id === chosen.target);
        if (tIdx >= 0) { idx = tIdx; continue; }
        return { kind: 'ai', target: chosen.target };
      }
      // No valid selection after retries -> fall through to next node or hang up.
      idx++;
      continue;
    }

    // Any routing/terminal node ends the flow with an action for the bridge.
    if (['route_van', 'route_user', 'route_group', 'voicemail', 'hangup'].includes(node.type)) {
      return nodeToTerminal(node);
    }

    idx++;  // unknown node type -> skip
  }
  return { kind: 'hangup' };
}
