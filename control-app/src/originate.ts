// control-app/src/originate.ts
// Step 1 — outbound origination (click-to-call / API makeCall).
//
// Two-leg "callback" origination, the standard click-to-call model:
//   1. Create a mixing bridge.
//   2. Originate leg A to the AGENT's registered device (PJSIP/tnt_xxx). Their
//      softphone or browser (WebRTC) rings; when they answer, they're in Stasis.
//   3. Originate leg B to the DESTINATION number out through a carrier trunk
//      (PJSIP/<number>@<trunk>, e.g. kasooko-endpoint for NG).
//   4. When the destination answers, add both legs to the bridge -> connected.
//   5. If either side fails/hangs up, tear everything down cleanly.
//
// This mirrors bridge.ts but originates BOTH legs (bridge.ts had an inbound
// caller already in Stasis; here the agent leg is originated by us).

import type Ari from 'ari-client';

function log(...args: unknown[]) {
  console.log(new Date().toISOString(), '[originate]', ...args);
}

export interface OriginateOptions {
  client: Ari.Client;
  agentEndpoint: string;     // e.g. "PJSIP/tnt_beec44b3" (the agent's device)
  to: string;                // destination number, e.g. "2348012345678"
  trunk: string;             // Asterisk trunk endpoint, e.g. "kasooko-endpoint"
  callerId?: string;         // caller ID to present to the destination
  agentRingSec?: number;     // how long to ring the agent before giving up
  destRingSec?: number;      // how long to ring the destination
}

export interface OriginateResult {
  callid: string;            // our correlation id (the bridge id)
  agentChannelId: string;
}

// Originate an outbound click-to-call. Resolves once both legs are bridged (or
// rejects if the agent leg can't be created). Destination failures after the
// agent answers are handled via cleanup (agent hears the call end).
export async function originateCall(opts: OriginateOptions): Promise<OriginateResult> {
  const { client, agentEndpoint, to, trunk } = opts;
  const agentRing = opts.agentRingSec ?? 30;
  const destRing = opts.destRingSec ?? 45;

  const bridge = client.Bridge();
  await bridge.create({ type: 'mixing' });
  log(`bridge ${bridge.id} created for click-to-call ${agentEndpoint} -> ${to} via ${trunk}`);

  const agentChan = client.Channel();
  let destChan: Ari.Channel | null = null;
  let cleanedUp = false;

  const cleanup = async (reason: string) => {
    if (cleanedUp) return;
    cleanedUp = true;
    log(`cleanup bridge ${bridge.id} (${reason})`);
    try { if (destChan) await destChan.hangup(); } catch { /* gone */ }
    try { await agentChan.hangup(); } catch { /* gone */ }
    try { await bridge.destroy(); } catch { /* gone */ }
    client.removeListener('StasisStart', onStasisStart as never);
  };

  // Single StasisStart handler for both legs (matched by channel id).
  const onStasisStart = async (_event: unknown, ch: Ari.Channel) => {
    // --- Agent answered: put them in the bridge, then dial the destination ---
    if (ch.id === agentChan.id) {
      log(`agent ${ch.id} answered -> bridging + dialing destination ${to}`);
      try {
        await ch.answer().catch(() => { /* may already be answered */ });
        await bridge.addChannel({ channel: ch.id });
      } catch (err) {
        log(`failed to add agent to bridge: ${(err as Error)?.message}`);
        return void cleanup('agent bridge-add failed');
      }
      // Now originate the destination leg out through the trunk.
      const dest = client.Channel();
      destChan = dest;
      dest.once('ChannelDestroyed', () => { void cleanup('destination hung up'); });
      dest.once('StasisEnd', () => { void cleanup('destination left'); });
      try {
        await dest.originate({
          endpoint: `PJSIP/${to}@${trunk}`,
          app: 'telroi',
          appArgs: 'dialed',
          callerId: opts.callerId || 'Telroi',
          timeout: destRing
        });
        log(`originating destination PJSIP/${to}@${trunk} (ring ${destRing}s)`);
      } catch (err) {
        log(`destination originate failed: ${(err as Error)?.message}`);
        void cleanup('destination originate failed');
      }
      return;
    }
    // --- Destination answered: add to bridge -> the two are connected ---
    if (destChan && ch.id === destChan.id) {
      log(`destination ${ch.id} answered -> adding to bridge ${bridge.id}`);
      try {
        await ch.answer().catch(() => {});
        await bridge.addChannel({ channel: ch.id });
        log(`bridged: agent ${agentChan.id} <-> destination ${ch.id}`);
      } catch (err) {
        log(`failed to bridge destination: ${(err as Error)?.message}`);
        void cleanup('destination bridge-add failed');
      }
      return;
    }
  };

  client.on('StasisStart', onStasisStart as never);

  // If the agent leg ends before answering, tear down.
  agentChan.once('ChannelDestroyed', () => { void cleanup('agent hung up / no answer'); });
  agentChan.once('StasisEnd', () => { void cleanup('agent left'); });

  // Originate the AGENT leg (rings their device).
  try {
    await agentChan.originate({
      endpoint: agentEndpoint,
      app: 'telroi',
      appArgs: 'agent',
      callerId: opts.callerId || 'Telroi',
      timeout: agentRing
    });
    log(`originating agent ${agentEndpoint} (ring ${agentRing}s)`);
  } catch (err) {
    await cleanup('agent originate failed');
    throw err;
  }

  return { callid: bridge.id, agentChannelId: agentChan.id };
}
