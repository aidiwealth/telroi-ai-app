// control-app/src/index.ts
// Telroi ARI Control App — Stage 2 (cache-backed routing).
//
// Pipeline on each inbound call entering Stasis(telroi):
//   1. Read the dialed DID + caller number from the StasisStart event.
//   2. Resolve DID -> client (tenantId) + routing config  — from the LOCAL CACHE
//      (no transatlantic DB query on the call path; see cache.ts).
//   3. Blacklist check (cache) -> reject blocked callers.
//   4. Log the call to NYC asynchronously (fire-and-forget; never blocks).
//   5. Route per the cached config: ai | dial_person | dial_department | reject.
//      (Stage 2 announces the decision via playback; actual AI/bridge come in
//       later stages. The decision logic is real and final.)
//
// Designed for the London-PBX / NYC-DB split: all per-call lookups are in-memory,
// writes are async. The caller never waits on the Atlantic.

import Ari from 'ari-client';
import { config } from './config.ts';
import { startCache, lookupNumber, isBlacklisted, isAnonymousBlocked, agentGreeting, resolveEndpoint, resolveTenantEndpoints, resolveDepartmentEndpoints, resolveDepartmentByName, cacheReady, cacheStats } from './cache.ts';
import { logCall } from './call-log.ts';
import { installLogCapture } from './log-buffer.ts';
import { closeDb } from './db.ts';
import { bridgeToEndpoint, bridgeToDepartment, synthesizeMessage } from './bridge.ts';
import { holdUntilFree, startChannelReaper } from './queue.ts';
import { startProvisionAgent } from './provision-agent.ts';
import { attachTelnyxMedia } from './telnyx-media.ts';
import { attachTwilioMedia } from './twilio-media.ts';
import { startScheduler } from './scheduler.ts';

// Filter a list of PJSIP usernames to only those currently REGISTERED (online),
// so ring_all doesn't waste originate attempts on stale/disconnected endpoints
// ("Allocation failed"). Uses ARI endpoint state; on any error, keeps the endpoint
// (fail-open) so a lookup glitch never silently drops a reachable agent.
const WEBAPP_URL = process.env.WEBAPP_URL || 'https://app.telroi.ai';
const INTERNAL_SECRET = process.env.PROVISION_AGENT_SECRET || process.env.TELROI_INTERNAL_SECRET || '';

// Check the tenant's paid concurrent-channel limit before connecting an inbound
// AI call. Uses the web app's unified live-call count (dialer + widget + API +
// inbound together). Fail-open: if the check errors/times out, allow the call
// (never drop a real caller because of a transient capacity-lookup failure).
/**
 * Who is on this guest endpoint. A widget call arrives as its endpoint's username,
 * which means nothing to whoever answers — the lease knows the visitor, so ask.
 */
async function guestCallerName(username: string): Promise<string | null> {
  try {
    const res = await fetch(`${WEBAPP_URL}/api/voice/guest-caller?username=${encodeURIComponent(username)}`, {
      headers: { 'x-telroi-internal': INTERNAL_SECRET },
      signal: AbortSignal.timeout(3000)
    });
    if (!res.ok) return null;
    const j = await res.json() as { name?: string | null };
    return j.name || null;
  } catch {
    return null;   // a nameless caller still gets through
  }
}

/**
 * Can this workspace take the call, and can its AI answer it?
 *
 * Both are asked at once because they're decided together: an AI route whose
 * trial allowance is spent, or whose wallet is empty, should reach a person
 * rather than a stream that will fail silently. Fails open on either — a check
 * we couldn't make is a poor reason to refuse a caller.
 */
async function inboundCapacity(tenantId: string, log: (m: string) => void): Promise<{ ok: boolean; ai: boolean; aiReason: string | null }> {
  try {
    const res = await fetch(`${WEBAPP_URL}/api/voice/capacity?tenantId=${encodeURIComponent(tenantId)}`, {
      headers: { 'x-telroi-internal': INTERNAL_SECRET },
      signal: AbortSignal.timeout(4000)
    });
    if (!res.ok) { log(`capacity check HTTP ${res.status} — allowing (fail-open)`); return { ok: true, ai: true, aiReason: null }; }
    const u = await res.json() as { capacity: number; inUse: number; ok: boolean; ai?: boolean; aiReason?: string | null };
    log(`capacity: ${u.inUse}/${u.capacity} in use -> ${u.ok ? 'OK' : 'BUSY'}${u.ai === false ? ` (AI unavailable: ${u.aiReason})` : ''}`);
    return { ok: !!u.ok, ai: u.ai !== false, aiReason: u.aiReason ?? null };
  } catch (e) {
    log(`capacity check failed (${(e as Error)?.message}) — allowing (fail-open)`);
    return { ok: true, ai: true, aiReason: null };
  }
}


async function filterLiveEndpoints(client: any, usernames: string[], log: (m: string) => void): Promise<string[]> {
  const checks = await Promise.all(usernames.map(async (u) => {
    try {
      const ep = await client.endpoints.get({ tech: 'PJSIP', resource: u });
      // ARI reports state: 'online' (registered) | 'offline' (no contact) | 'unknown'.
      // channel_ids holds whatever calls the endpoint is already on — ringing an
      // agent mid-conversation would interrupt them, and the caller would hear it
      // ring out while somebody else was free.
      const busy = Array.isArray(ep?.channel_ids) && ep.channel_ids.length > 0;
      if (busy) log(`  [ring] ${u} is on a call — skipping`);
      return { u, keep: ep?.state === 'online' && !busy };
    } catch (e) {
      // Fail-open: a lookup glitch shouldn't drop a possibly-reachable agent.
      log(`  [ring_all] endpoint ${u} state check failed (${(e as Error)?.message}) — keeping`);
      return { u, keep: true };
    }
  }));
  return checks.filter((c) => c.keep).map((c) => c.u);
}

// Endpoint to bridge "person" routes to. For now this is a fixed stand-in
// Person-routes bridge to the client's provisioned SIP endpoint (route_target ->
// sip_endpoints.id -> PJSIP/<username>). If it doesn't resolve, the call plays a
// no-service message rather than bridging to any default/fallback endpoint.
// BRIDGE_ENDPOINT retained only for an optional explicit override via env.
const BRIDGE_ENDPOINT = process.env.BRIDGE_ENDPOINT || '';

function log(...args: unknown[]) {
  console.log(new Date().toISOString(), '[control-app]', ...args);
}

async function main() {
  installLogCapture();  // capture all console output into the ring buffer for the admin live-log viewer
  // -- Start the routing cache first (blocks on initial load) --
  log('Loading routing cache from database...');
  let stopCache: () => void;
  try {
    stopCache = await startCache();
  } catch (err) {
    console.error('[control-app] cache failed to start:', err);
    process.exit(1);
  }
  if (!cacheReady()) {
    log('WARNING: cache did not load (DB unreachable?). Continuing - calls will be rejected until it loads.');
  } else {
    log('Cache ready:', cacheStats());
  }

  // -- Connect to ARI (local Asterisk on this box) --
  log(`Connecting to ARI at ${config.ari.url} as app "${config.ari.appName}"...`);
  let client: Ari.Client;
  try {
    client = await Ari.connect(config.ari.url, config.ari.username, config.ari.password);
  } catch (err) {
    console.error('[control-app] FAILED to connect to ARI:', err);
    process.exit(1);
  }
  try {
    const info = await client.asterisk.getInfo();
    log(`Connected. Asterisk ${info.system?.version}`);
  } catch { log('Connected to ARI.'); }

  // -- Start the provisioning agent now that ARI is up; pass the client so the
  //    /originate endpoint can place outbound calls. (No-op if no secret set.) --
  const agentServer = startProvisionAgent(client);
  // Attach the Telnyx AI media WebSocket to the same HTTP server (shares :8090).
  if (agentServer) { try { attachTelnyxMedia(agentServer); } catch (e) { log('telnyx-media attach failed:', (e as Error).message); } }
  if (agentServer) { try { attachTwilioMedia(agentServer); } catch (e) { log('twilio-media attach failed:', (e as Error).message); } }
  try { startScheduler(); } catch (e) { log('scheduler failed to start:', (e as Error).message); }
  try { startChannelReaper(client, (m) => log(m)); } catch (e) { log('reaper failed to start:', (e as Error).message); }

  // -- Handle each call entering Stasis --
  client.on('StasisStart', async (event, channel) => {
    console.log(new Date().toISOString(), '[stasis] entered:', channel.id, 'args:', JSON.stringify(event.args || []));
    // Outbound bridge legs we originate (the callee side) enter Stasis too,
    // marked with appArgs 'dialed'. The bridge module handles those — do NOT
    // re-route them as if they were inbound callers.
    // A voice OTP: answer, read the code, hang up. Nothing to bridge and nobody
    // to route to — the whole call is the announcement. Digits are spoken from
    // Asterisk's own sound files, so the code never reaches a third party.
    if (event.args?.[0] === 'otp') {
      const code = String(event.args?.[1] || '');
      const repeats = Math.max(1, Math.min(Number(event.args?.[2]) || 2, 5));
      log(`  [otp ${chId}] answered — reading ${code.length} digits, ${repeats}x`);
      try {
        await channel.answer();
        await new Promise((r) => setTimeout(r, 800));
        for (let i = 0; i < repeats; i++) {
          const p1 = await channel.play({ media: 'sound:telroi-vcode' });
          await new Promise<void>((done) => p1.once('PlaybackFinished' as any, () => done()));
          const p2 = await channel.play({ media: `digits:${code.split('').join('')}` });
          await new Promise<void>((done) => p2.once('PlaybackFinished' as any, () => done()));
          await new Promise((r) => setTimeout(r, 600));
        }
      } catch (e) {
        log(`  [otp ${chId}] failed: ${(e as Error)?.message}`);
      } finally {
        try { await channel.hangup(); } catch { /* already gone */ }
      }
      return;
    }

    if (event.args?.[0] === 'dialed' || event.args?.[0] === 'agent') {
      return;
    }
    let dialedDid = event.args?.[0] || channel.dialplan?.exten || '';
    const callerNum = channel.caller?.number || '';
    const callerName = channel.caller?.name || '';
    const chId = channel.id;

    // Escalation handoff from a carrier that can't reach our agents directly.
    // A Telnyx-hosted AI call has no ARI channel, so when it needs a human the
    // media adapter transfers it back to us as sip:esc-<DID>@sip.telroi.ai. The
    // esc- prefix says "ring this DID's agents" — without it we'd look the DID up
    // and hand the caller straight back to the AI they just escaped from.
    const isEscalation = dialedDid.startsWith('esc-');
    // The call being continued rides after a double hyphen, so the time a human
    // spends can be recorded against it rather than disappearing as an untracked
    // second leg. Handoffs made before this carry no id — route them anyway.
    let escCallId: string | null = null;
    if (isEscalation) {
      const rest = dialedDid.slice(4);
      const cut = rest.indexOf('--');
      if (cut >= 0) {
        // Hex on the wire: a SIP user part can't carry the colon one carrier puts
        // in its call ids. Anything that isn't hex is from an older handoff — take
        // it as-is rather than dropping the call over a formatting change.
        const raw = rest.slice(cut + 2);
        escCallId = /^[0-9a-f]+$/i.test(raw) && raw.length % 2 === 0
          ? Buffer.from(raw, 'hex').toString('utf8')
          : (raw || null);
        dialedDid = rest.slice(0, cut);
      }
      else dialedDid = rest;
    }

    // Live Call widget: the visitor's browser registered to us as a guest endpoint
    // and dialled the one extension its context allows. The guest dialplan passes
    // the tenant id, which was fixed when the endpoint was leased.
    const widgetTenantId = dialedDid.startsWith('widget:') ? dialedDid.slice(7) : null;

    log(`[call ${chId}] from "${callerName}" <${callerNum}> -> DID ${dialedDid}${isEscalation ? ' (ESCALATION -> agents)' : ''}`);

    try {
      await channel.answer();

      // 0) Live Call widget. There is no DID to resolve — the web app decided the
      // tenant and the route when the visitor clicked, and carried both in the
      // extension. Ring that tenant's agents and bridge; anything the DID lookup
      // below would do (route type, blacklist) has already been settled.
      if (widgetTenantId) {
        const allUsers = resolveTenantEndpoints(widgetTenantId);
        const free = async () => (await filterLiveEndpoints(client, allUsers, log)).map((u) => `PJSIP/${u}`);
        const visitorName = await guestCallerName(String(callerNum || ''));
        let endpoints = await free();
        log(`  [widget ${chId}] tenant ${widgetTenantId} — ${endpoints.length} live of ${allUsers.length} endpoint(s)`);
        const unavailable = async () => {
          const msg = await synthesizeMessage("I'm sorry, no one is available to take your call right now. Please try again a little later. Goodbye.", widgetTenantId).catch(() => null);
          try { await playAndHangup(client, channel, msg || 'sound:vm-nobodyavail'); } catch { try { await channel.hangup(); } catch { /* gone */ } }
        };
        if (!endpoints.length) {
          // Busy agents mean a wait, not a closed door — hold them as we would a
          // phone caller. Nobody registered at all is a different matter.
          if (!allUsers.length) { await unavailable(); return; }
          const held = await holdUntilFree({
            client, channel, tenantId: widgetTenantId, freeEndpoints: free, log,
            say: (t) => synthesizeMessage(t, widgetTenantId).catch(() => null)
          });
          if (!held) { try { await channel.hangup(); } catch { /* gone */ } return; }
          endpoints = held;
        }
        let wRes: { answered: boolean } = { answered: false };
        try {
          wRes = await bridgeToDepartment({
            // The caller id on a guest leg is the endpoint's own username, which
            // tells an agent nothing — use the visitor's name where we have it.
            client, caller: channel, endpoints, callerIdNum: visitorName || 'Web visitor', ringTimeoutSec: 40
          });
        } catch (err) {
          log(`  [widget ${chId}] bridge failed: ${(err as Error)?.message}`);
        }
        if (!wRes.answered) {
          log(`  [widget ${chId}] not answered`);
          await unavailable();
        }
        return;
      }

      // 1) Resolve DID -> client + routing (from cache)
      const route = lookupNumber(dialedDid);
      if (!route) {
        log(`  x no client found for DID ${dialedDid} - rejecting`);
        await playAndHangup(client, channel, 'sound:ss-noservice');
        return;
      }
      if (route.status !== 'active') {
        log(`  x DID ${dialedDid} subscription not active (${route.status}) - rejecting`);
        await playAndHangup(client, channel, 'sound:ss-noservice');
        return;
      }

      // 2) Anonymous (no caller-id) block — tenant setting
      if (isAnonymousBlocked(route.tenantId, callerNum)) {
        log(`  BLOCKED anonymous caller for tenant ${route.tenantId} - rejecting`);
        logCall({ tenantId: route.tenantId, callid: chId, phone: callerNum || 'anonymous', status: 'blacklisted', direction: 'in' });
        await playAndHangup(client, channel, 'sound:ss-noservice');
        return;
      }

      // 3) Blacklist check (cache)
      if (isBlacklisted(route.tenantId, callerNum)) {
        log(`  BLOCKED caller ${callerNum} blacklisted for tenant ${route.tenantId} - rejecting`);
        logCall({ tenantId: route.tenantId, callid: chId, phone: callerNum, status: 'blacklisted', direction: 'in' });
        await playAndHangup(client, channel, 'sound:ss-noservice');
        return;
      }

      // 2.5) Concurrency limit — check BEFORE logging this call as in-flight, so
      //       the current call doesn't count itself. Over capacity -> "all lines busy".
      // Both answers come back together: whether there's room for the call, and
      // whether the AI can actually answer it. The second decides routing further
      // down, so it's held rather than asked for twice.
      const cap = await inboundCapacity(route.tenantId, (m) => log(`  [${chId}] ${m}`));
      // An escalation is the same conversation continuing, not a second call —
      // the caller's original leg is still holding the channel it was counted
      // against. Refusing it meant a workspace on one channel could never hand
      // anyone to a human: the AI said "connecting you" and the line went dead.
      if (!cap.ok && !isEscalation) {
        log(`  tenant at channel capacity — playing busy`);
        logCall({ tenantId: route.tenantId, callid: chId, phone: callerNum, status: 'missed', direction: 'in', raw: { did: dialedDid, reason: 'channels_busy' } });
        const busyMsg = route.routeType === 'ai' && route.routeAgentId
          ? await synthesizeMessage('All of our lines are currently busy. Please call back in a few minutes. Thank you.', route.tenantId, route.routeAgentId).catch(() => null)
          : null;
        await playAndHangup(client, channel, busyMsg || 'sound:ss-noservice');
        return;
      }

      // 3) Log the call as RINGING (async, fire-and-forget). The real outcome
      //    (answered / ended / no-answer / failed) is upserted by the bridge's
      //    onStatus callback as the call progresses. We record the dialed DID in
      //    raw so the history can show which number was called.
      // An escalation handoff isn't its own call — the customer's AI call is
      // already logged by the carrier webhook, and this leg's "caller" is our own
      // DID, which would show up as a bogus inbound-from-ourselves row that never
      // completes. Skip it. (Merging the agent's talk time into the original
      // call's record is where the agent's talk time goes: the carrier call id
      // rides in the handoff address and lands as agentSeconds on the original.)
      if (!isEscalation) {
        logCall({
          tenantId: route.tenantId, callid: chId, phone: callerNum,
          status: 'ringing', direction: 'in',
          raw: { did: dialedDid, callerName }
        });
      }

      // 3.5) Published Connect flow — run greeting/menu IVR, then let its terminal
      //      decide the effective routing. A flow overrides the flat routeType.
      let effRouteType = route.routeType;
      let effAgentId = route.routeAgentId;
      let effDeptId = route.departmentId;
      let effTarget = route.routeTarget;
      if (Array.isArray(route.flowNodes) && route.flowNodes.length) {
        log(`  flow bound to DID — running IVR (${route.flowNodes.length} nodes)`);
        try { await channel.answer(); } catch { /* already answered */ }
        // The IVR has picked up — log the call as answered so history + wait
        // reflect it (the flow may then route on to AI/person/dept or hang up).
        logCall({ tenantId: route.tenantId, callid: chId, phone: callerNum, status: 'answered', direction: 'in', wait: 0, raw: { did: dialedDid, callerName, ivr: true } });
        const { runFlow } = await import('./flow-run.ts');
        const term = await runFlow(client, channel, route.flowNodes, route.tenantId, route.routeAgentId || undefined, (m) => log(`  ${m}`));
        log(`  flow terminal: ${term.kind}${term.target ? ' -> ' + term.target : ''}`);
        if (term.kind === 'hangup') {
          try { await playAndHangup(client, channel, 'sound:vm-goodbye'); } catch { try { await channel.hangup(); } catch { /* gone */ } }
          logCall({ tenantId: route.tenantId, callid: chId, phone: callerNum, status: 'ended', direction: 'in' });
          return;
        }
        // If the flow routes onward, mark ended when the caller channel leaves Stasis
        // (safety net so flow calls never linger as 'answered').
        channel.once('StasisEnd', () => {
          logCall({ tenantId: route.tenantId, callid: chId, phone: callerNum, status: 'ended', direction: 'in' });
        });
        effRouteType = term.kind === 'ai' ? 'ai' : term.kind === 'department' ? 'department' : 'person';
        if (term.kind === 'ai') effAgentId = term.target || route.routeAgentId;
        if (term.kind === 'department') effDeptId = term.target || effDeptId;
        if (term.kind === 'person') effTarget = term.target || effTarget;
      }

      // 3.5) Escalation handoff: skip routing entirely and ring the tenant's
      // agents. The caller already spoke to the AI (over another carrier) and
      // asked for a human, so re-running the route would loop them back to it.
      if (isEscalation) {
        const allUsers = resolveTenantEndpoints(route.tenantId);
        const freeEsc = async () => (await filterLiveEndpoints(client, allUsers, log)).map((u) => `PJSIP/${u}`);
        let endpoints = await freeEsc();
        log(`  [esc ${chId}] ringing agents — ${endpoints.length} live of ${allUsers.length} endpoint(s)`);
        // A carrier-routed ring-all call arrives here, so it needs holding too —
        // otherwise callers on those numbers are turned away the moment every
        // agent is mid-conversation, while callers on a trunk-routed number wait.
        if (!endpoints.length && allUsers.length) {
          const held = await holdUntilFree({
            client, channel, tenantId: route.tenantId, freeEndpoints: freeEsc, log,
            say: (t) => synthesizeMessage(t, route.tenantId, route.routeAgentId || undefined).catch(() => null)
          });
          if (held) endpoints = held;
        }
        if (!endpoints.length) {
          // No row to update — this leg isn't logged (see above), so don't create
          // an orphan 'missed' row for it.
          const msg = await synthesizeMessage("I'm sorry, no one is available to take your call right now. Please try again a little later. Goodbye.", route.tenantId, route.routeAgentId || undefined).catch(() => null);
          try { await playAndHangup(client, channel, msg || 'sound:vm-nobodyavail'); } catch { try { await channel.hangup(); } catch { /* gone */ } }
          return;
        }
        let escRes: { answered: boolean } = { answered: false };
        try {
          const escStart = Date.now();
          escRes = await bridgeToDepartment({
            client, caller: channel, endpoints, callerIdNum: callerNum || 'Telroi', ringTimeoutSec: 40,
            // Record against the call this continues. Without an id there's
            // nothing to attach to, so the leg stays unlogged as before rather
            // than creating a row the customer would find baffling.
            onStatus: escCallId ? (status, details) => {
              if (status !== 'ended' && status !== 'answered') return;
              const agent = details?.endpoint ? details.endpoint.replace(/^PJSIP\//, '') : undefined;
              logCall({
                // A prefix, not the whole id — the address can't carry a full
                // carrier call id, so logCall resolves it to the real one.
                tenantId: route.tenantId, callid: escCallId!, callidIsPrefix: true, phone: callerNum, direction: 'in',
                status: 'answered', user: agent,
                agentSeconds: status === 'ended' ? Math.round((Date.now() - escStart) / 1000) : undefined
              } as any);
            } : undefined
          });
        } catch (err) {
          log(`  [esc ${chId}] bridge failed: ${(err as Error)?.message}`);
        }
        if (!escRes.answered) {
          log(`  [esc ${chId}] not answered — playing unavailable message`);
          const msg = await synthesizeMessage("I'm sorry, no one is available to take your call right now. Please try again a little later. Goodbye.", route.tenantId, route.routeAgentId || undefined).catch(() => null);
          try { await playAndHangup(client, channel, msg || 'sound:vm-nobodyavail'); } catch { try { await channel.hangup(); } catch { /* gone */ } }
        }
        return;
      }

      // 4) Route per config (flow terminal overrides where applicable)
      log(`  OK tenant=${route.tenantId} routeType=${effRouteType}`);
      switch (effRouteType) {
        case 'ai': {
          const agentId = effAgentId;
          if (!agentId) {
            log(`     AI route but no agent configured — playing no-service`);
            logCall({ tenantId: route.tenantId, callid: chId, phone: callerNum, status: 'missed', direction: 'in' });
            await playAndHangup(client, channel, 'sound:ss-noservice');
            break;
          }
          // The AI can't answer — trial allowance spent, or a wallet with nothing
          // in it. Ring whoever's at their desk instead: the business still takes
          // the call, just with a person. Anything spoken here uses a stock prompt
          // rather than synthesis, since synthesis is the thing that's unavailable.
          if (!cap.ai) {
            log(`     AI unavailable (${cap.aiReason}) — ringing agents instead`);
            const allUsers = resolveTenantEndpoints(route.tenantId);
            const liveUsers = await filterLiveEndpoints(client, allUsers, log);
            const endpoints = liveUsers.map((u) => `PJSIP/${u}`);
            if (!endpoints.length) {
              log(`     nobody available either — playing no-service`);
              logCall({ tenantId: route.tenantId, callid: chId, phone: callerNum, status: 'missed', direction: 'in', raw: { did: dialedDid, reason: cap.aiReason } });
              await playAndHangup(client, channel, 'sound:ss-noservice');
              break;
            }
            logCall({ tenantId: route.tenantId, callid: chId, phone: callerNum, status: 'ringing', direction: 'in', raw: { did: dialedDid, reason: cap.aiReason } });
            try {
              await bridgeToDepartment({
                client, caller: channel, endpoints, callerIdNum: callerNum || 'Telroi', ringTimeoutSec: 40,
                onStatus: (status, details) => {
                  const agent = details?.endpoint ? details.endpoint.replace(/^PJSIP\//, '') : undefined;
                  logCall({ tenantId: route.tenantId, callid: chId, phone: callerNum, status, direction: 'in', duration: details?.duration, user: agent });
                }
              });
            } catch (err) {
              log(`     fallback bridge failed: ${(err as Error)?.message}`);
              await playAndHangup(client, channel, 'sound:ss-noservice');
            }
            break;
          }

          log(`     AI route -> agent ${agentId} (turn-based conversation)`);
          logCall({ tenantId: route.tenantId, callid: chId, phone: callerNum, status: 'answered', direction: 'in', raw: { did: dialedDid, callerName, agent: agentId } });
          // Terminal-status guarantee: whenever the caller channel leaves the app
          // (normal end, transfer, hangup, or an unexpected throw in runAiCall), mark
          // the call ended so it can never linger as 'answered' and falsely consume a
          // channel. Upserts by callid, so a richer terminal status written elsewhere
          // (e.g. bridge 'ended' with duration) still stands; this is the safety net.
          channel.once('StasisEnd', () => {
            logCall({ tenantId: route.tenantId, callid: chId, phone: callerNum, status: 'ended', direction: 'in' });
          });
          const { runAiCall } = await import('./ai-call.ts');
          await runAiCall({
            client, channel,
            tenantId: route.tenantId,
            agentId,
            telnum: dialedDid,
            callId: chId,
            escalateAfterSec: route.routeEscalateAfter || 0,
            log: (m: string) => log(`  [ai ${chId}] ${m}`),
            onTransfer: async (transferTo: string | null, department?: string | null) => {
              // A named department wins over the configured escalation: the caller
              // said what they needed, and ringing everyone instead is a worse
              // answer than the one they asked for.
              if (department) {
                const members = resolveDepartmentByName(route.tenantId, department);
                if (members.length) {
                  const live = await filterLiveEndpoints(client, members, log);
                  log(`  [ai ${chId}] transfer to department "${department}" - ${live.length} live of ${members.length}`);
                  if (live.length) {
                    let dr: { answered: boolean } = { answered: false };
                    try {
                      dr = await bridgeToDepartment({
                        client, caller: channel, endpoints: live.map((u) => `PJSIP/${u}`),
                        callerIdNum: callerNum || 'Telroi', ringTimeoutSec: 40,
                        onStatus: () => { /* the bridge logs its own */ }
                      });
                    } catch (err) {
                      log(`  [ai ${chId}] department bridge failed: ${(err as Error)?.message}`);
                    }
                    if (dr.answered) return;
                  }
                  log(`  [ai ${chId}] department "${department}" unavailable - falling back`);
                } else {
                  log(`  [ai ${chId}] no department matched "${department}" - falling back`);
                }
              }

              // Escalation is CLIENT-CONFIGURED via route.routeEscalateMode:
              //   none      -> graceful message, no handoff (never a bare drop)
              //   endpoint  -> ring one connected endpoint (route.routeEscalateTo = endpoint id)
              //   phone     -> dial a real number out via the carrier trunk
              //   ring_all  -> ring ALL the tenant's registered endpoints, first answer wins
              const mode = route.routeEscalateMode || 'none';
              const target = transferTo || route.routeEscalateTo;
              const whisperText = `A I transfer. Caller ${callerNum ? 'from ' + callerNum.split('').join(' ') : 'unknown number'}. Connecting you now.`;
              const logStatus = (user?: string) => (status: any, details?: any) =>
                logCall({ tenantId: route.tenantId, callid: chId, phone: callerNum, status, direction: 'in', duration: details?.duration, user });

              // Mode: none — say we can't transfer, then hang up gracefully (no cold drop).
              if (mode === 'none') {
                log(`  [ai ${chId}] escalation mode=none — playing graceful message`);
                logCall({ tenantId: route.tenantId, callid: chId, phone: callerNum, status: 'ended', direction: 'in' });
                try { await playAndHangup(client, channel, 'sound:vm-goodbye'); } catch { try { await channel.hangup(); } catch { /* gone */ } }
                return;
              }

              // Mode: ring_all — ring every registered endpoint for this tenant.
              if (mode === 'ring_all') {
                const allUsers = resolveTenantEndpoints(route.tenantId);
                // Temporary: a client's escalation rang an endpoint belonging to
                // the support workspace, and narrowing by elimination has been
                // wrong three times. This says plainly which tenant was asked for
                // and what came back.
                log(`  [ai ${chId}] ring_all for tenant ${route.tenantId} -> ${JSON.stringify(allUsers)}`);
                const liveUsers = await filterLiveEndpoints(client, allUsers, log);
                const endpoints = liveUsers.map((u) => `PJSIP/${u}`);
                log(`  [ai ${chId}] escalation mode=ring_all — ${endpoints.length} live of ${allUsers.length} endpoint(s)`);
                if (!endpoints.length) {
                  logCall({ tenantId: route.tenantId, callid: chId, phone: callerNum, status: 'missed', direction: 'in' });
                  try { await playAndHangup(client, channel, 'sound:ss-noservice'); } catch { try { await channel.hangup(); } catch { /* gone */ } }
                  return;
                }
                let raResult: { answered: boolean } = { answered: false };
                try {
                  raResult = await bridgeToDepartment({
                    client, caller: channel, endpoints, callerIdNum: callerNum || 'Telroi', ringTimeoutSec: 40,
                    onStatus: (status, details) => logStatus(details?.endpoint ? details.endpoint.replace(/^PJSIP\//, '') : undefined)(status, details)
                  });
                } catch (err) {
                  log(`  [ai ${chId}] ring_all bridge failed: ${(err as Error)?.message}`);
                }
                if (!raResult.answered) {
                  log(`  [ai ${chId}] ring_all not answered — playing unavailable message`);
                  const msg = await synthesizeMessage("I'm sorry, no one is available to take your call right now. Please try again a little later. Goodbye.", route.tenantId, route.routeAgentId || undefined).catch(() => null);
                  try { await playAndHangup(client, channel, msg || 'sound:vm-nobodyavail'); }
                  catch { try { await channel.hangup(); } catch { /* gone */ } }
                }
                return;
              }

              // Modes: endpoint / phone — resolve a single dial target.
              let dialEndpoint: string | null = null;
              let user: string | undefined;
              if (mode === 'endpoint') {
                const username = target ? resolveEndpoint(target) : null;
                if (username) { dialEndpoint = `PJSIP/${username}`; user = username; }
              } else if (mode === 'phone') {
                const digits = (target || '').replace(/[^0-9]/g, '');
                if (digits.length >= 7) {
                  const trunk = route.provider ? `${route.provider}-endpoint` : 'ruach-endpoint';
                  dialEndpoint = `PJSIP/${digits}@${trunk}`;
                  log(`  [ai ${chId}] escalating to phone ${digits} via ${trunk}`);
                }
              }
              if (!dialEndpoint) {
                log(`  [ai ${chId}] escalation mode=${mode} but target unresolved — graceful hangup`);
                logCall({ tenantId: route.tenantId, callid: chId, phone: callerNum, status: 'ended', direction: 'in' });
                try { await playAndHangup(client, channel, 'sound:vm-goodbye'); } catch { try { await channel.hangup(); } catch { /* gone */ } }
                return;
              }
              log(`  [ai ${chId}] escalating to human ${target} (${dialEndpoint})`);
              let escResult: { answered: boolean } = { answered: false };
              try {
                escResult = await bridgeToEndpoint({
                  client, caller: channel, endpoint: dialEndpoint,
                  callerIdNum: callerNum || 'Telroi', ringTimeoutSec: 40,
                  whisperText, whisperTenantId: route.tenantId, whisperAgentId: route.routeAgentId || undefined,
                  onStatus: (status, details) => logStatus(user)(status, details)
                });
              } catch (err) {
                log(`  [ai ${chId}] escalation bridge failed: ${(err as Error)?.message}`);
              }
              // The bridge now resolves only when the call reaches a terminal state,
              // so this reliably reflects whether a human actually answered. If not,
              // tell the caller the team is unavailable rather than dropping to silence.
              if (!escResult.answered) {
                log(`  [ai ${chId}] escalation not answered — playing unavailable message`);
                const msg = await synthesizeMessage("I'm sorry, no one is available to take your call right now. Please try again a little later. Goodbye.", route.tenantId, route.routeAgentId || undefined).catch(() => null);
                try { await playAndHangup(client, channel, msg || 'sound:vm-nobodyavail'); }
                catch { try { await channel.hangup(); } catch { /* gone */ } }
              }
            },
            onEnd: (turns: number) => {
              log(`  [ai ${chId}] conversation ended after ${turns} turn(s)`);
              logCall({ tenantId: route.tenantId, callid: chId, phone: callerNum, status: 'ended', direction: 'in' });
            }
          });
          break;
        }
        case 'department': {
          const deptEndpoints = resolveDepartmentEndpoints(effDeptId);
          log(`     Department route -> ${effDeptId} :: ${deptEndpoints.length} member endpoint(s)`);
          if (deptEndpoints.length === 0) {
            log(`     department has no reachable members — playing no-service`);
            logCall({ tenantId: route.tenantId, callid: chId, phone: callerNum, status: 'missed', direction: 'in' });
            await playAndHangup(client, channel, 'sound:ss-noservice');
            break;
          }
          try {
            await bridgeToDepartment({
              client,
              caller: channel,
              endpoints: deptEndpoints,
              callerIdNum: callerNum || 'Telroi',
              ringTimeoutSec: 25,
              onStatus: (status, details) => {
                const agent = details?.endpoint ? details.endpoint.replace(/^PJSIP\//, '') : undefined;
                logCall({
                  tenantId: route.tenantId, callid: chId, phone: callerNum,
                  status, direction: 'in', duration: details?.duration, user: agent
                });
              }
            });
          } catch (err) {
            log(`     department bridge failed: ${(err as Error)?.message} — playing fallback`);
            await playAndHangup(client, channel, 'sound:ss-noservice');
          }
          break;
        }
        // Ring everyone who's free, first to answer takes it. The routing options
        // offer this, and the escalation path has always honoured it, but an
        // ordinary inbound call fell through to the person case and died looking
        // for a single target it was never given.
        case 'ring_all': {
          const allUsers = resolveTenantEndpoints(route.tenantId);
          const free = async () => (await filterLiveEndpoints(client, allUsers, log)).map((u) => `PJSIP/${u}`);
          let endpoints = await free();
          log(`     Ring-all route -> ${endpoints.length} available of ${allUsers.length} endpoint(s)`);
          if (!endpoints.length) {
            // Everyone is mid-call rather than absent, so hold the caller instead
            // of turning them away — they keep their place and are told where
            // they stand until somebody frees up.
            if (allUsers.length) {
              const held = await holdUntilFree({
                client, channel, tenantId: route.tenantId, freeEndpoints: free, log,
                say: (t) => synthesizeMessage(t, route.tenantId, route.routeAgentId || undefined).catch(() => null)
              });
              if (!held) {
                logCall({ tenantId: route.tenantId, callid: chId, phone: callerNum, status: 'missed', direction: 'in' });
                try { await channel.hangup(); } catch { /* gone */ }
                break;
              }
              endpoints = held;
            } else {
              log(`     no agents at all — playing no-service`);
              logCall({ tenantId: route.tenantId, callid: chId, phone: callerNum, status: 'missed', direction: 'in' });
              await playAndHangup(client, channel, 'sound:ss-noservice');
              break;
            }
          }
          try {
            await bridgeToDepartment({
              client,
              caller: channel,
              endpoints,
              callerIdNum: callerNum || 'Telroi',
              ringTimeoutSec: 40,
              onStatus: (status, details) => {
                const agent = details?.endpoint ? details.endpoint.replace(/^PJSIP\//, '') : undefined;
                logCall({
                  tenantId: route.tenantId, callid: chId, phone: callerNum,
                  status, direction: 'in', duration: details?.duration, user: agent
                });
              }
            });
          } catch (err) {
            log(`     ring-all bridge failed: ${(err as Error)?.message} — playing fallback`);
            await playAndHangup(client, channel, 'sound:ss-noservice');
          }
          break;
        }
        case 'person':
        default: {
          // Option B: route_target holds a sip_endpoints.id. Resolve it to the
          // client's SIP username and bridge to PJSIP/<username>. If route_target
          // is empty or doesn't resolve, play no-service and hang up (no fallback
          // to any default endpoint).
          const username = resolveEndpoint(effTarget);
          if (!username) {
            // No resolvable destination endpoint. Do NOT bridge to a stray/fallback
            // endpoint — play a polite no-service message and hang up.
            log(`     Person route -> ${effTarget} did not resolve to an endpoint :: no destination, playing no-service`);
            logCall({ tenantId: route.tenantId, callid: chId, phone: callerNum, status: 'missed', direction: 'in', raw: { reason: 'no_destination_endpoint' } });
            await playAndHangup(client, channel, 'sound:ss-noservice');
            break;
          }
          const endpoint = `PJSIP/${username}`;
          log(`     Person route -> endpoint ${effTarget} (${username}) :: bridging to ${endpoint}`);
          try {
            await bridgeToEndpoint({
              client,
              caller: channel,
              endpoint,
              callerIdNum: callerNum || 'Telroi',
              ringTimeoutSec: 30,
              onStatus: (status, details) => {
                logCall({
                  tenantId: route.tenantId, callid: chId, phone: callerNum,
                  status, direction: 'in', duration: details?.duration,
                  user: username || undefined
                });
              }
            });
            // Bridging is now managed by bridge.ts (it owns teardown on hangup).
            // We do NOT hang up here — the call is live.
          } catch (err) {
            log(`     bridge failed: ${(err as Error)?.message} — playing fallback`);
            await playAndHangup(client, channel, 'sound:ss-noservice');
          }
          break;
        }
      }
    } catch (err) {
      console.error(`[control-app] error on channel ${chId}:`, err);
    } finally {
      // However this call ended, leave Stasis with the channel down. One left up
      // sits in the application indefinitely — and since ringing now skips a busy
      // endpoint, a single stale channel takes that agent out of service for good.
      // Harmless when the channel is already gone, which is the common case.
      try { await channel.hangup(); } catch { /* already down */ }
    }
  });

  client.on('StasisEnd', (_e, channel) => log(`   end ${channel.id}`));

  client.start(config.ari.appName);
  log(`Listening on Stasis app "${config.ari.appName}". Dial 700 to test.`);

  const shutdown = async () => {
    log('Shutting down...');
    try { stopCache(); } catch { /* */ }
    try { client.stop(); } catch { /* */ }
    await closeDb();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

// Helper: play a sound then hang up when it finishes.
async function playAndHangup(client: Ari.Client, channel: Ari.Channel, media: string) {
  try {
    const playback = client.Playback();
    await channel.play({ media }, playback);
    playback.once('PlaybackFinished', async () => {
      try { await channel.hangup(); } catch { /* gone */ }
    });
  } catch {
    try { await channel.hangup(); } catch { /* gone */ }
  }
}

main().catch((err) => {
  console.error('[control-app] fatal:', err);
  process.exit(1);
});
