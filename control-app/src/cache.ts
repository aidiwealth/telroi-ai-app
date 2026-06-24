// control-app/src/cache.ts
// ───────────────────────────────────────────────────────────────────────────
// Local routing cache (Option 1 for the London-PBX / NYC-DB split).
//
// WHY: the control app runs in London; the database is in NYC (~70-80ms RTT).
// Querying NYC on every inbound call would add hundreds of ms of dead air while
// the caller waits to be routed. Instead we load the small, slow-changing
// routing tables into memory once, refresh them on a timer, and answer every
// per-call routing question from RAM (microseconds, no transatlantic trip).
//
// WHAT WE CACHE (all small, change infrequently):
//   • number_subscriptions  -> DID (telnum) => { tenantId, routing config }
//   • blacklist             -> set of (tenantId|telnum) blocked pairs
//   • ai_agents greetings   -> agentId => greeting text
//
// WRITES (call logs) do NOT go through here — they're fire-and-forget to NYC
// (see call-log.ts), so the caller never waits on a write either.
// ───────────────────────────────────────────────────────────────────────────
import { db, schema } from './db.ts';
import { config } from './config.ts';

export interface NumberRoute {
  tenantId: string;
  telnum: string;
  status: string;                 // active | suspended | cancelled
  routeType: 'person' | 'department' | 'ai';
  routeTarget: string | null;     // person extension/user
  departmentId: string | null;
  routeAgentId: string | null;
  routeEscalateTo: string | null;
  routeEscalateAfter: number;
}

interface CacheState {
  // DID (normalized) -> route
  numbers: Map<string, NumberRoute>;
  // "tenantId|telnum" -> true  (blocked)
  blacklist: Set<string>;
  // agentId -> greeting
  agentGreetings: Map<string, string>;
  // sip_endpoints.id -> sip_username  (Option B: route_target holds the id)
  sipEndpoints: Map<string, string>;
  loadedAt: number;
  ok: boolean;
}

let state: CacheState = {
  numbers: new Map(),
  blacklist: new Set(),
  agentGreetings: new Map(),
  sipEndpoints: new Map(),
  loadedAt: 0,
  ok: false
};

function log(...args: unknown[]) {
  console.log(new Date().toISOString(), '[cache]', ...args);
}

// Normalize a phone number for consistent matching: strip everything except
// digits (so +234..., 234..., spaces, etc. all compare equal on the digits).
export function normNum(raw: string | null | undefined): string {
  if (!raw) return '';
  return raw.replace(/[^0-9]/g, '');
}

// ── Load everything from NYC into fresh maps, then atomically swap in. ──
export async function refreshCache(): Promise<void> {
  try {
    const numbers = new Map<string, NumberRoute>();
    const blacklist = new Set<string>();
    const agentGreetings = new Map<string, string>();
    const sipEndpoints = new Map<string, string>();

    // number_subscriptions — DID -> client + routing. Only active subs matter.
    const subs = await db.select({
      tenantId: schema.numberSubscriptions.tenantId,
      telnum: schema.numberSubscriptions.telnum,
      status: schema.numberSubscriptions.status,
      routeType: schema.numberSubscriptions.routeType,
      routeTarget: schema.numberSubscriptions.routeTarget,
      departmentId: schema.numberSubscriptions.departmentId,
      routeAgentId: schema.numberSubscriptions.routeAgentId,
      routeEscalateTo: schema.numberSubscriptions.routeEscalateTo,
      routeEscalateAfter: schema.numberSubscriptions.routeEscalateAfter
    }).from(schema.numberSubscriptions);

    for (const s of subs) {
      const key = normNum(s.telnum);
      if (!key) continue;
      numbers.set(key, {
        tenantId: s.tenantId,
        telnum: s.telnum,
        status: s.status,
        routeType: (s.routeType as NumberRoute['routeType']) || 'person',
        routeTarget: s.routeTarget ?? null,
        departmentId: s.departmentId ?? null,
        routeAgentId: s.routeAgentId ?? null,
        routeEscalateTo: s.routeEscalateTo ?? null,
        routeEscalateAfter: s.routeEscalateAfter ?? 0
      });
    }

    // blacklist — (tenantId, telnum) pairs to reject.
    const bl = await db.select({
      tenantId: schema.blacklist.tenantId,
      telnum: schema.blacklist.telnum
    }).from(schema.blacklist);
    for (const b of bl) {
      const num = normNum(b.telnum);
      if (num) blacklist.add(`${b.tenantId}|${num}`);
    }

    // ai_agents greetings — for AI-routed numbers.
    const agents = await db.select({
      id: schema.aiAgents.id,
      greeting: schema.aiAgents.greeting
    }).from(schema.aiAgents);
    for (const a of agents) {
      if (a.greeting) agentGreetings.set(a.id, a.greeting);
    }

    // sip_endpoints — id -> sip_username. Option B: a person route's route_target
    // holds the sip_endpoints.id; we resolve it to the username to bridge to
    // PJSIP/<username>. Decoupling id from username means credentials can rotate
    // without breaking routing.
    const eps = await db.select({
      id: schema.sipEndpoints.id,
      sipUsername: schema.sipEndpoints.sipUsername
    }).from(schema.sipEndpoints);
    for (const e of eps) {
      if (e.sipUsername) sipEndpoints.set(e.id, e.sipUsername);
    }

    state = { numbers, blacklist, agentGreetings, sipEndpoints, loadedAt: Date.now(), ok: true };
    log(`refreshed: ${numbers.size} numbers, ${blacklist.size} blacklist entries, ${agentGreetings.size} agent greetings, ${sipEndpoints.size} sip endpoints`);
  } catch (err) {
    // On failure, keep the previous (stale) cache rather than wiping it — a brief
    // NYC blip shouldn't break call routing. Just log and try again next tick.
    console.error('[cache] refresh FAILED (keeping previous data):', (err as Error)?.message || err);
    if (!state.ok) {
      // First load failed — we have nothing. Surface this clearly.
      log('WARNING: initial cache load failed; routing will be unavailable until DB is reachable.');
    }
  }
}

// ── Lookups (all from RAM — instant, no DB round trip) ──

export function lookupNumber(dialedDid: string): NumberRoute | null {
  return state.numbers.get(normNum(dialedDid)) || null;
}

export function isBlacklisted(tenantId: string, callerNum: string): boolean {
  const num = normNum(callerNum);
  if (!num) return false;
  return state.blacklist.has(`${tenantId}|${num}`);
}

export function agentGreeting(agentId: string | null): string | null {
  if (!agentId) return null;
  return state.agentGreetings.get(agentId) || null;
}

// Option B: resolve a route_target (a sip_endpoints.id) to its SIP username,
// so the bridge can dial PJSIP/<username>. Returns null if not found (e.g. the
// endpoint was deleted, or route_target isn't an endpoint id).
export function resolveEndpoint(endpointId: string | null): string | null {
  if (!endpointId) return null;
  return state.sipEndpoints.get(endpointId) || null;
}

export function cacheReady(): boolean {
  return state.ok;
}

export function cacheStats() {
  return {
    ok: state.ok,
    numbers: state.numbers.size,
    blacklist: state.blacklist.size,
    agentGreetings: state.agentGreetings.size,
    sipEndpoints: state.sipEndpoints.size,
    ageMs: state.loadedAt ? Date.now() - state.loadedAt : null
  };
}

// ── Start the periodic refresh loop. Returns a stop() to clear the timer. ──
let timer: ReturnType<typeof setInterval> | null = null;

export async function startCache(): Promise<() => void> {
  const intervalMs = Number(process.env.CACHE_REFRESH_MS || 30000); // default 30s
  log(`initial load from DB...`);
  await refreshCache(); // block startup on the first load so we route correctly from call #1
  timer = setInterval(() => { void refreshCache(); }, intervalMs);
  log(`auto-refresh every ${intervalMs}ms`);
  return () => { if (timer) clearInterval(timer); timer = null; };
}
