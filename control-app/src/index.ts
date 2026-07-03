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
import { startCache, lookupNumber, isBlacklisted, isAnonymousBlocked, agentGreeting, resolveEndpoint, resolveTenantEndpoints, resolveDepartmentEndpoints, cacheReady, cacheStats } from './cache.ts';
import { logCall } from './call-log.ts';
import { closeDb } from './db.ts';
import { bridgeToEndpoint, bridgeToDepartment, synthesizeMessage } from './bridge.ts';
import { startProvisionAgent } from './provision-agent.ts';

// Endpoint to bridge "person" routes to. For now this is a fixed stand-in
// (test1) to prove bridging; later, route_target maps to the client's real
// provisioned SIP endpoint. Override via BRIDGE_ENDPOINT env if needed.
const BRIDGE_ENDPOINT = process.env.BRIDGE_ENDPOINT || 'PJSIP/test1';

function log(...args: unknown[]) {
  console.log(new Date().toISOString(), '[control-app]', ...args);
}

async function main() {
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
  startProvisionAgent(client);

  // -- Handle each call entering Stasis --
  client.on('StasisStart', async (event, channel) => {
    // Outbound bridge legs we originate (the callee side) enter Stasis too,
    // marked with appArgs 'dialed'. The bridge module handles those — do NOT
    // re-route them as if they were inbound callers.
    if (event.args?.[0] === 'dialed' || event.args?.[0] === 'agent') {
      return;
    }
    const dialedDid = event.args?.[0] || channel.dialplan?.exten || '';
    const callerNum = channel.caller?.number || '';
    const callerName = channel.caller?.name || '';
    const chId = channel.id;

    log(`[call ${chId}] from "${callerName}" <${callerNum}> -> DID ${dialedDid}`);

    try {
      await channel.answer();

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

      // 3) Log the call as RINGING (async, fire-and-forget). The real outcome
      //    (answered / ended / no-answer / failed) is upserted by the bridge's
      //    onStatus callback as the call progresses. We record the dialed DID in
      //    raw so the history can show which number was called.
      logCall({
        tenantId: route.tenantId, callid: chId, phone: callerNum,
        status: 'ringing', direction: 'in',
        raw: { did: dialedDid, callerName }
      });

      // 4) Route per config
      log(`  OK tenant=${route.tenantId} routeType=${route.routeType}`);
      switch (route.routeType) {
        case 'ai': {
          const agentId = route.routeAgentId;
          if (!agentId) {
            log(`     AI route but no agent configured — playing no-service`);
            logCall({ tenantId: route.tenantId, callid: chId, phone: callerNum, status: 'missed', direction: 'in' });
            await playAndHangup(client, channel, 'sound:ss-noservice');
            break;
          }
          log(`     AI route -> agent ${agentId} (turn-based conversation)`);
          logCall({ tenantId: route.tenantId, callid: chId, phone: callerNum, status: 'answered', direction: 'in', raw: { did: dialedDid, callerName, agent: agentId } });
          const { runAiCall } = await import('./ai-call.ts');
          await runAiCall({
            client, channel,
            tenantId: route.tenantId,
            agentId,
            callId: chId,
            escalateAfterSec: route.routeEscalateAfter || 0,
            log: (m: string) => log(`  [ai ${chId}] ${m}`),
            onTransfer: async (transferTo: string | null) => {
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
                const endpoints = resolveTenantEndpoints(route.tenantId).map((u) => `PJSIP/${u}`);
                log(`  [ai ${chId}] escalation mode=ring_all — ${endpoints.length} endpoint(s)`);
                if (!endpoints.length) {
                  logCall({ tenantId: route.tenantId, callid: chId, phone: callerNum, status: 'missed', direction: 'in' });
                  try { await playAndHangup(client, channel, 'sound:ss-noservice'); } catch { try { await channel.hangup(); } catch { /* gone */ } }
                  return;
                }
                let raAnswered = false;
                try {
                  await bridgeToDepartment({
                    client, caller: channel, endpoints, callerIdNum: callerNum || 'Telroi', ringTimeoutSec: 40,
                    onStatus: (status, details) => { if (status === 'answered') raAnswered = true; logStatus(details?.endpoint ? details.endpoint.replace(/^PJSIP\//, '') : undefined)(status, details); }
                  });
                } catch (err) {
                  log(`  [ai ${chId}] ring_all bridge failed: ${(err as Error)?.message}`);
                }
                // NOTE: no-answer message disabled (see endpoint case) — re-enable once
                // bridgeToDepartment awaits a terminal state.
                void raAnswered;
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
              let escAnswered = false;
              try {
                await bridgeToEndpoint({
                  client, caller: channel, endpoint: dialEndpoint,
                  callerIdNum: callerNum || 'Telroi', ringTimeoutSec: 40,
                  whisperText, whisperTenantId: route.tenantId, whisperAgentId: route.routeAgentId || undefined,
                  onStatus: (status, details) => { if (status === 'answered') escAnswered = true; logStatus(user)(status, details); }
                });
              } catch (err) {
                log(`  [ai ${chId}] escalation bridge failed: ${(err as Error)?.message}`);
              }
              // If nobody answered (ring timed out / busy / rejected), don't leave the
              // caller in silence — tell them the team is unavailable, then hang up.
              // NOTE: no-answer message disabled — bridgeToEndpoint resolves before the
              // call is actually answered, so escAnswered is unreliable. Re-enable once
              // the bridge awaits a terminal state. Bridge tears down on its own.
              void escAnswered;
            },
            onEnd: (turns: number) => {
              log(`  [ai ${chId}] conversation ended after ${turns} turn(s)`);
              logCall({ tenantId: route.tenantId, callid: chId, phone: callerNum, status: 'ended', direction: 'in' });
            }
          });
          break;
        }
        case 'department': {
          const deptEndpoints = resolveDepartmentEndpoints(route.departmentId);
          log(`     Department route -> ${route.departmentId} :: ${deptEndpoints.length} member endpoint(s)`);
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
        case 'person':
        default: {
          // Option B: route_target holds a sip_endpoints.id. Resolve it to the
          // client's SIP username and bridge to PJSIP/<username>. If route_target
          // is empty or doesn't resolve, fall back to BRIDGE_ENDPOINT (test1) so
          // existing test data still works during the transition.
          const username = resolveEndpoint(route.routeTarget);
          const endpoint = username ? `PJSIP/${username}` : BRIDGE_ENDPOINT;
          if (username) {
            log(`     Person route -> endpoint ${route.routeTarget} (${username}) :: bridging to ${endpoint}`);
          } else {
            log(`     Person route -> ${route.routeTarget} did not resolve to an endpoint :: falling back to ${BRIDGE_ENDPOINT}`);
          }
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
      try { await channel.hangup(); } catch { /* gone */ }
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
