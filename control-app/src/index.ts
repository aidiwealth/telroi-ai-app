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
import { startCache, lookupNumber, isBlacklisted, agentGreeting, cacheReady, cacheStats } from './cache.ts';
import { logCall } from './call-log.ts';
import { closeDb } from './db.ts';
import { bridgeToEndpoint } from './bridge.ts';

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

  // -- Handle each call entering Stasis --
  client.on('StasisStart', async (event, channel) => {
    // Outbound bridge legs we originate (the callee side) enter Stasis too,
    // marked with appArgs 'dialed'. The bridge module handles those — do NOT
    // re-route them as if they were inbound callers.
    if (event.args?.[0] === 'dialed') {
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

      // 2) Blacklist check (cache)
      if (isBlacklisted(route.tenantId, callerNum)) {
        log(`  BLOCKED caller ${callerNum} blacklisted for tenant ${route.tenantId} - rejecting`);
        logCall({ tenantId: route.tenantId, callid: chId, phone: callerNum, status: 'blacklisted', direction: 'in' });
        await playAndHangup(client, channel, 'sound:ss-noservice');
        return;
      }

      // 3) Log the call (async, fire-and-forget to NYC)
      logCall({ tenantId: route.tenantId, callid: chId, phone: callerNum, status: 'answered', direction: 'in' });

      // 4) Route per config
      log(`  OK tenant=${route.tenantId} routeType=${route.routeType}`);
      switch (route.routeType) {
        case 'ai': {
          const greeting = agentGreeting(route.routeAgentId) || 'Hello, thanks for calling. How can I help you today?';
          log(`     AI route. greeting="${greeting}". (AI agent integration: later stage)`);
          await playAndHangup(client, channel, 'sound:hello-world');
          break;
        }
        case 'department': {
          log(`     Department route -> ${route.departmentId}. (Bridge to department: later stage)`);
          await playAndHangup(client, channel, 'sound:hello-world');
          break;
        }
        case 'person':
        default: {
          // Stage 6: actually bridge the caller to a SIP device. For now we
          // bridge to BRIDGE_ENDPOINT (test1) as the stand-in for the client's
          // device; later route.routeTarget maps to the client's real endpoint.
          log(`     Person route -> ${route.routeTarget} :: bridging caller to ${BRIDGE_ENDPOINT}`);
          try {
            await bridgeToEndpoint({
              client,
              caller: channel,
              endpoint: BRIDGE_ENDPOINT,
              callerIdNum: callerNum || 'Telroi',
              ringTimeoutSec: 30
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
