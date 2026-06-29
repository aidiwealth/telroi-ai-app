// control-app/src/call-log.ts
// Fire-and-forget call logging to the NYC database.
//
// Writes go to call_events. Because London->NYC is ~70-80ms, we NEVER await
// these on the call path — we kick them off and move on, so the caller is never
// held up by a transatlantic write. If a write fails, we log it and drop it
// (a missing CRM row is far better than a delayed/blocked call).
//
// call_events has a unique index on (tenant_id, callid), so repeated writes for
// the same call (ringing -> answered -> ended) upsert instead of duplicating.
import { db, schema } from './db.ts';
import { sql } from 'drizzle-orm';

export interface CallLogInput {
  tenantId: string;
  callid: string;             // Asterisk channel id or Call-ID
  direction?: 'in' | 'out';
  phone?: string;             // the other party
  status?: string;            // ringing | answered | ended | rejected | blacklisted
  carrier?: string;           // ruach | kasooko | telroi ...
  startedAt?: Date;
  duration?: number;
  raw?: Record<string, unknown>;
}

// Upsert a call event without blocking. Safe to call multiple times per call.
export function logCall(input: CallLogInput): void {
  // Intentionally not awaited by callers. We swallow errors here.
  void (async () => {
    try {
      await db.insert(schema.callEvents).values({
        tenantId: input.tenantId,
        callid: input.callid,
        direction: input.direction ?? 'in',
        phone: input.phone ?? null,
        status: input.status ?? null,
        carrier: input.carrier ?? null,
        startedAt: input.startedAt ?? new Date(),
        duration: input.duration ?? null,
        raw: input.raw ?? {}
      }).onConflictDoUpdate({
        target: [schema.callEvents.tenantId, schema.callEvents.callid],
        set: {
          status: sql`excluded.status`,
          duration: sql`excluded.duration`,
          phone: sql`excluded.phone`
        }
      });
    } catch (err) {
      console.error('[call-log] write failed (dropped):', (err as Error)?.message || err);
    }
  })();
}

// ── Outbound (dialplan) call logging ────────────────────────────────────────
// Browser-dialer outbound calls go WebRTC -> dialplan -> trunk, never touching
// ARI/Stasis. The outbound carrier route calls this (via the agent's
// /log-outbound endpoint) AFTER Dial() completes, so we capture the real
// outcome. Resolve tenant from the agent's SIP username (tnt_xxxxxxxx).
import { eq } from 'drizzle-orm';

export interface OutboundLogInput {
  agentUsername: string;
  dialed: string;
  carrier?: string;
  dialstatus?: string;
  duration?: number;
  startEpoch?: number;
  callid?: string;
}

function mapDialStatus(s?: string): string {
  switch ((s || '').toUpperCase()) {
    case 'ANSWER': return 'answered';
    case 'NOANSWER':
    case 'CANCEL': return 'missed';
    case 'BUSY':
    case 'CONGESTION':
    case 'CHANUNAVAIL':
    case 'DONTCALL':
    case 'TORTURE':
    case 'INVALIDARGS': return 'failed';
    default: return s ? 'failed' : 'answered';
  }
}

export function logOutbound(input: OutboundLogInput): void {
  void (async () => {
    try {
      const username = (input.agentUsername || '').replace(/^PJSIP\//, '').trim();
      if (!username) { console.error('[call-log] logOutbound: no agent username'); return; }
      const [ep] = await db.select({ tenantId: schema.sipEndpoints.tenantId })
        .from(schema.sipEndpoints)
        .where(eq(schema.sipEndpoints.sipUsername, username))
        .limit(1);
      if (!ep?.tenantId) { console.error(`[call-log] logOutbound: no tenant for ${username}`); return; }
      const callid = input.callid || `out-${username}-${input.startEpoch || Date.now()}`;
      const startedAt = input.startEpoch ? new Date(input.startEpoch * 1000) : new Date();
      const status = mapDialStatus(input.dialstatus);
      await db.insert(schema.callEvents).values({
        tenantId: ep.tenantId,
        callid,
        direction: 'out',
        phone: input.dialed || null,
        status,
        carrier: input.carrier || null,
        startedAt,
        duration: input.duration ?? null,
        raw: { agent: username, dialed: input.dialed, dialstatus: input.dialstatus, carrier: input.carrier }
      }).onConflictDoUpdate({
        target: [schema.callEvents.tenantId, schema.callEvents.callid],
        set: { status: sql`excluded.status`, duration: sql`excluded.duration`, phone: sql`excluded.phone` }
      });
      console.log(`[call-log] outbound logged: ${username} -> ${input.dialed} (${status}, ${input.duration ?? '?'}s via ${input.carrier || '?'})`);
    } catch (err) {
      console.error('[call-log] logOutbound write failed (dropped):', (err as Error)?.message || err);
    }
  })();
}
