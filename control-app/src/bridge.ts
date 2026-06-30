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

function log(...args: unknown[]) {
  console.log(new Date().toISOString(), '[bridge]', ...args);
}

export interface BridgeOptions {
  client: Ari.Client;
  caller: Ari.Channel;      // the inbound channel already in Stasis
  endpoint: string;         // e.g. "PJSIP/test1"
  callerIdNum?: string;     // caller id to present to the callee
  ringTimeoutSec?: number;  // how long to ring the target before giving up
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

  const onMemberStasisStart = async (_event: unknown, ch: Ari.Channel) => {
    if (!callees.some((c) => c.id === ch.id)) return;
    if (answeredId) { try { await ch.hangup(); } catch { /* gone */ } return; }
    answeredId = ch.id;
    answeredEndpoint = channelEndpoint.get(ch.id) || null;
    answeredAt = Date.now();
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
