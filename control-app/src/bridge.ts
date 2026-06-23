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

  const cleanup = async (reason: string) => {
    if (cleanedUp) return;
    cleanedUp = true;
    log(`cleanup bridge ${bridge.id} (${reason})`);
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
