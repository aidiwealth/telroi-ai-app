// control-app/src/bridge.ts
// Stage 6 — bridge an inbound caller to a target SIP device.
//
// ARI bridging flow:
//   1. Create a mixing bridge (connects audio between channels).
//   2. Add the inbound caller channel to the bridge.
//   3. Originate an outbound channel to the target endpoint (e.g. PJSIP/test1).
//   4. When the target answers, add it to the bridge -> the two are connected.
//   5. If either side hangs up, tear everything down cleanly.
//
// The `target` is an Asterisk endpoint string like "PJSIP/test1". Later, when
// per-client SIP provisioning exists, route_target maps to the client's real
// registered endpoint; for now we bridge to a known endpoint (test1) to prove it.

import type Ari from 'ari-client';
import { promises as fs } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';

const pexec = promisify(execFile);
const WHISPER_TMP = '/var/lib/asterisk/sounds/telroi-whisper';
const WEBAPP_URL = process.env.WEBAPP_URL || 'https://app.telroi.ai';
const INTERNAL_SECRET = process.env.INTERNAL_SECRET || process.env.PROVISION_AGENT_SECRET || '';

function log(...args: unknown[]) {
  console.log(new Date().toISOString(), '[bridge]', ...args);
}

export async function synthesizeMessage(text: string, tenantId?: string, agentId?: string): Promise<string | null> {
  return prepWhisper(text, tenantId, agentId);
}

async function prepWhisper(text: string, tenantId?: string, agentId?: string): Promise<string | null> {
  if (!text || !tenantId || !INTERNAL_SECRET) return null;
  try {
    const res = await fetch(`${WEBAPP_URL}/api/voice/ai/whisper-tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-telroi-internal': INTERNAL_SECRET },
      body: JSON.stringify({ tenantId, agentId, text }),
      signal: AbortSignal.timeout(8000)
    });
    if (!res.ok) return null;
    const j: any = await res.json();
    if (!j?.audioBase64) return null;
    await fs.mkdir(WHISPER_TMP, { recursive: true });
    const id = randomUUID();
    const raw = `${WHISPER_TMP}/${id}-raw`;
    const out = `${WHISPER_TMP}/${id}`;
    const buf = Buffer.from(j.audioBase64, 'base64');
    const ct = String(j.audioContentType || '');
    if (/l16|pcm/i.test(ct)) {
      const rate = /rate=(\d+)/.exec(ct)?.[1] || '16000';
      await fs.writeFile(`${raw}.raw`, buf);
      await pexec('sox', ['-t', 'raw', '-r', rate, '-e', 'signed', '-b', '16', '-c', '1', `${raw}.raw`, '-r', '8000', '-c', '1', `${out}.wav`]);
    } else {
      await fs.writeFile(`${raw}.in`, buf);
      await pexec('sox', [`${raw}.in`, '-r', '8000', '-c', '1', `${out}.wav`]);
    }
    return `sound:${out}`;
  } catch { return null; }
}

async function playToChannel(client: Ari.Client, channel: Ari.Channel, media: string): Promise<void> {
  try {
    const playback = client.Playback();
    await channel.play({ media }, playback);
    await new Promise<void>((resolve) => {
      let done = false;
      const finish = () => { if (!done) { done = true; resolve(); } };
      playback.once('PlaybackFinished', finish);
      setTimeout(finish, 12000);
    });
  } catch { /* best-effort */ }
}

export interface BridgeOptions {
  client: Ari.Client;
  caller: Ari.Channel;      // the inbound channel already in Stasis
  endpoint: string;         // e.g. "PJSIP/test1"
  callerIdNum?: string;     // caller id to present to the callee
  ringTimeoutSec?: number;  // how long to ring the target before giving up
  whisperText?: string;       // spoken to the callee (human) before joining
  whisperTenantId?: string;
  whisperAgentId?: string;
  // Reports real call lifecycle so the caller can log it: 'answered' when the
  // callee picks up, then a terminal status ('ended' | 'no-answer' | 'failed').
  onStatus?: (status: 'answered' | 'ended' | 'no-answer' | 'failed', details?: { duration?: number }) => void;
}

// Bridge the caller to the endpoint. Resolves when the bridge is set up (or the
// call ends); rejects only on unexpected setup errors.
export async function bridgeToEndpoint(opts: BridgeOptions): Promise<void> {
  const { client, caller, endpoint } = opts;
  const ringTimeout = opts.ringTimeoutSec ?? 30;

  // 1) Create the mixing bridge.
  const bridge = client.Bridge();
  await bridge.create({ type: 'mixing' });
  log(`bridge ${bridge.id} created for caller ${caller.id} -> ${endpoint}`);

  // Track the outbound (callee) channel so we can clean it up.
  let callee: Ari.Channel | null = null;
  let cleanedUp = false;
  let wasAnswered = false;
  let answeredAt = 0;

  const cleanup = async (reason: string) => {
    if (cleanedUp) return;
    cleanedUp = true;
    try { if (typeof stopRing === 'function') await stopRing(); } catch { /* ignore */ }
    log(`cleanup bridge ${bridge.id} (${reason})`);
    if (opts.onStatus) {
      let terminal: 'ended' | 'no-answer' | 'failed';
      if (wasAnswered) terminal = 'ended';
      else if (reason === 'originate failed' || reason === 'failed to add caller' || reason === 'bridge add failed') terminal = 'failed';
      else terminal = 'no-answer';
      const duration = answeredAt ? Math.round((Date.now() - answeredAt) / 1000) : 0;
      try { opts.onStatus(terminal, { duration }); } catch { /* logging must never break teardown */ }
    }
    try { if (callee) await callee.hangup(); } catch { /* gone */ }
    try { await bridge.destroy(); } catch { /* gone */ }
  };

  // 2) Put the caller into the bridge right away (they'll hear ringing/silence
  //    until the callee answers; for nicer UX we could play ringing — later).
  try {
    await bridge.addChannel({ channel: caller.id });
  } catch (err) {
    await cleanup('failed to add caller');
    throw err;
  }

  // If the caller hangs up while we're connecting, tear down.
  caller.once('StasisEnd', () => { void cleanup('caller left'); });
  caller.once('ChannelDestroyed', () => { void cleanup('caller destroyed'); });

  // Play ringback to the caller so they know we're connecting them to a human
  // (silence during a transfer feels like a dropped call). Stopped on answer/cleanup.
  let ringing = false;
  const stopRing = async () => {
    if (!ringing) return;
    ringing = false;
    try { await caller.ringStop(); } catch { /* not ringing */ }
  };
  const startRing = async () => {
    if (ringing) return;
    ringing = true;
    try { await caller.ring(); } catch { /* ring optional */ }
  };

  // 3) Originate the outbound channel to the target endpoint.
  //    We originate INTO Stasis so we get control of the callee channel too.
  const calleeChan = client.Channel();
  callee = calleeChan;

  // When the callee channel enters Stasis (answered into our app), bridge it.
  const onCalleeStasisStart = async (_event: unknown, ch: Ari.Channel) => {
    if (ch.id !== calleeChan.id) return;
    log(`callee ${ch.id} answered -> adding to bridge ${bridge.id}`);
    try {
      await ch.answer();
      if (opts.whisperText) {
        const media = await prepWhisper(opts.whisperText, opts.whisperTenantId, opts.whisperAgentId);
        if (media && !cleanedUp) { log(`whispering to callee ${ch.id}`); await playToChannel(client, ch, media); }
      }
      if (cleanedUp) return;
      await stopRing();
      await bridge.addChannel({ channel: ch.id });
      wasAnswered = true;
      answeredAt = Date.now();
      if (opts.onStatus) { try { opts.onStatus('answered'); } catch { /* never break the call */ } }
      log(`bridged: ${caller.id} <-> ${ch.id}`);
    } catch (err) {
      log(`failed to bridge callee: ${(err as Error)?.message}`);
      void cleanup('bridge add failed');
    }
  };
  client.on('StasisStart', onCalleeStasisStart as never);

  // When the callee hangs up, tear down (caller will be returned/hung up).
  calleeChan.once('ChannelDestroyed', () => { void cleanup('callee hung up'); });
  calleeChan.once('StasisEnd', () => { void cleanup('callee left'); });

  try {
    await calleeChan.originate({
      endpoint,
      app: 'telroi',                       // bring the callee into our Stasis app
      appArgs: 'dialed',                   // marker so we know it's an outbound leg
      callerId: opts.callerIdNum || 'Telroi',
      timeout: ringTimeout
    });
    // Play ringback to the caller so they hear the human's line ringing instead
    // of dead silence during the transfer. Stopped when the callee answers.
    await startRing();
    log(`originating to ${endpoint} (ring timeout ${ringTimeout}s)`);
  } catch (err) {
    await cleanup('originate failed');
    throw err;
  }
}

// ── Department routing: ring multiple members, first to answer wins ──────────
export interface DepartmentBridgeOptions {
  client: Ari.Client;
  caller: Ari.Channel;
  endpoints: string[];
  callerIdNum?: string;
  ringTimeoutSec?: number;
  onStatus?: (status: 'answered' | 'ended' | 'no-answer' | 'failed', details?: { duration?: number; endpoint?: string }) => void;
}

export async function bridgeToDepartment(opts: DepartmentBridgeOptions): Promise<void> {
  const { client, caller } = opts;
  const endpoints = (opts.endpoints || []).filter(Boolean);
  const ringTimeout = opts.ringTimeoutSec ?? 25;

  if (endpoints.length === 0) {
    if (opts.onStatus) { try { opts.onStatus('no-answer'); } catch { /* noop */ } }
    return;
  }

  const bridge = client.Bridge();
  await bridge.create({ type: 'mixing' });
  log(`dept bridge ${bridge.id} created for caller ${caller.id} -> ${endpoints.length} member(s)`);

  const callees: Ari.Channel[] = [];
  const channelEndpoint = new Map<string, string>();
  let answeredId: string | null = null;
  let answeredEndpoint: string | null = null;
  let answeredAt = 0;
  let cleanedUp = false;
  let wasAnswered = false;

  const cleanup = async (reason: string) => {
    if (cleanedUp) return;
    cleanedUp = true;
    try { if (typeof stopDeptRing === 'function') await stopDeptRing(); } catch { /* ignore */ }
    log(`cleanup dept bridge ${bridge.id} (${reason})`);
    if (opts.onStatus) {
      let terminal: 'ended' | 'no-answer' | 'failed';
      if (wasAnswered) terminal = 'ended';
      else if (reason === 'all failed') terminal = 'failed';
      else terminal = 'no-answer';
      const duration = answeredAt ? Math.round((Date.now() - answeredAt) / 1000) : 0;
      try { opts.onStatus(terminal, { duration, endpoint: answeredEndpoint || undefined }); } catch { /* never break teardown */ }
    }
    for (const ch of callees) { try { await ch.hangup(); } catch { /* gone */ } }
    try { await bridge.destroy(); } catch { /* gone */ }
  };

  try {
    await bridge.addChannel({ channel: caller.id });
  } catch (err) {
    await cleanup('failed to add caller');
    throw err;
  }
  caller.once('StasisEnd', () => { void cleanup('caller left'); });
  caller.once('ChannelDestroyed', () => { void cleanup('caller destroyed'); });

  // Ringback so the caller hears the team's phones ringing, not silence.
  let deptRinging = false;
  const stopDeptRing = async () => { if (!deptRinging) return; deptRinging = false; try { await caller.ringStop(); } catch { /* */ } };
  const startDeptRing = async () => { if (deptRinging) return; deptRinging = true; try { await caller.ring(); } catch { /* */ } };

  const onMemberStasisStart = async (_event: unknown, ch: Ari.Channel) => {
    if (!callees.some((c) => c.id === ch.id)) return;
    if (answeredId) { try { await ch.hangup(); } catch { /* gone */ } return; }
    answeredId = ch.id;
    answeredEndpoint = channelEndpoint.get(ch.id) || null;
    answeredAt = Date.now();
    await stopDeptRing();
    log(`dept: ${ch.id} answered first -> bridging; cancelling other legs`);
    try {
      await ch.answer();
      await bridge.addChannel({ channel: ch.id });
      wasAnswered = true;
      if (opts.onStatus) { try { opts.onStatus('answered', { endpoint: answeredEndpoint || undefined }); } catch { /* noop */ } }
      for (const other of callees) {
        if (other.id !== ch.id) { try { await other.hangup(); } catch { /* gone */ } }
      }
      ch.once('ChannelDestroyed', () => { void cleanup('member hung up'); });
      ch.once('StasisEnd', () => { void cleanup('member left'); });
      log(`dept bridged: ${caller.id} <-> ${ch.id}`);
    } catch (err) {
      log(`dept failed to bridge member: ${(err as Error)?.message}`);
      void cleanup('bridge add failed');
    }
  };
  client.on('StasisStart', onMemberStasisStart as never);

  let originateFailures = 0;
  await startDeptRing();
  await Promise.all(endpoints.map(async (endpoint) => {
    const ch = client.Channel();
    callees.push(ch);
    channelEndpoint.set(ch.id, endpoint);
    try {
      await ch.originate({ endpoint, app: 'telroi', appArgs: 'dialed', callerId: opts.callerIdNum || 'Telroi', timeout: ringTimeout });
      log(`dept originating to ${endpoint} (ring ${ringTimeout}s)`);
    } catch (err) {
      originateFailures++;
      log(`dept originate to ${endpoint} failed: ${(err as Error)?.message}`);
    }
  }));

  if (originateFailures === endpoints.length) { await cleanup('all failed'); return; }

  setTimeout(() => {
    if (!answeredId && !cleanedUp) {
      log(`dept ring timeout (${ringTimeout}s) — no answer`);
      void cleanup('ring timeout');
    }
  }, (ringTimeout + 2) * 1000);
}
