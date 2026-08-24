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
import { sql, and, eq, like, desc } from 'drizzle-orm';
import { normalizePhone } from './phone.ts';

const WEBAPP_URL = process.env.WEBAPP_URL || 'https://app.telroi.ai';
const INTERNAL_SECRET = process.env.PROVISION_AGENT_SECRET || process.env.TELROI_INTERNAL_SECRET || '';

// The statuses that mean a call is over. Mirrors TERMINAL in the web app's
// call-log — a second copy, which is not ideal, but the alternative is the
// control app importing from a codebase it does not share.
//
// 'answered' is deliberately absent: logCall fires on it mid-call, and charging
// then would bill a conversation still in progress.
const TERMINAL_FOR_CHARGE = new Set(['ended', 'completed', 'failed', 'missed', 'busy', 'no-answer', 'no_answer']);

/** Charge for a call, through the web app.
 *
 *  Only the charge goes over — the log is written here, because this path does
 *  more than upsertCallEvent does and routing it wholesale would lose the
 *  duration inference and the ring-to-answer wait.
 *
 *  chargeCall keys its debit on the call id, so a repeated report charges once.
 */
async function chargeViaWebApp(body: {
  tenantId: string; callId: string; seconds: number; provider?: string; direction?: string;
}): Promise<boolean> {
  if (!INTERNAL_SECRET) return false;
  try {
    const res = await fetch(`${WEBAPP_URL}/api/internal/charge-call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-telroi-internal': INTERNAL_SECRET },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(4000)
    });
    return res.ok;
  } catch { return false; }
}

export interface CallLogInput {
  tenantId: string;
  callid: string;             // Asterisk channel id or Call-ID
  // When set, callid is only the first characters of the real one — an escalation
  // address can't carry a full carrier call id, so it carries enough to find it.
  callidIsPrefix?: boolean;
  direction?: 'in' | 'out';
  phone?: string;             // the other party
  status?: string;            // ringing | answered | ended | rejected | blacklisted
  carrier?: string;           // ruach | kasooko | telroi ...
  startedAt?: Date;
  duration?: number;
  wait?: number;
  // Seconds a human spent on a call the AI handed over. Kept apart from duration,
  // which stays the whole conversation.
  agentSeconds?: number;
  user?: string;
  raw?: Record<string, unknown>;
}

// Upsert a call event without blocking. Safe to call multiple times per call.
export function logCall(input: CallLogInput): void {
  // Intentionally not awaited by callers. We swallow errors here.
  void (async () => {
    try {
      let callid = input.callid;
      if (input.callidIsPrefix) {
        // Resolve to the real id before writing, or the upsert would create a row
        // keyed by the prefix rather than updating the call it belongs to. Most
        // recent wins if two ever share a prefix: the one still in progress is the
        // one being escalated.
        const [prior] = await db.select({ callid: schema.callEvents.callid })
          .from(schema.callEvents)
          .where(and(eq(schema.callEvents.tenantId, input.tenantId), like(schema.callEvents.callid, `${callid}%`)))
          .orderBy(desc(schema.callEvents.startedAt)).limit(1);
        if (!prior) return;   // nothing to attach to — better than an orphan row
        callid = prior.callid;
      }
      await db.insert(schema.callEvents).values({
        tenantId: input.tenantId,
        callid,
        direction: input.direction ?? 'in',
        phone: input.phone ? normalizePhone(input.phone) : null,
        status: input.status ?? null,
        carrier: input.carrier ?? null,
        startedAt: input.startedAt ?? new Date(),
        duration: input.duration ?? null,
        agentSeconds: input.agentSeconds ?? null,
        user: input.user ?? null,
        wait: input.wait ?? null,
        raw: input.raw ?? {}
      }).onConflictDoUpdate({
        target: [schema.callEvents.tenantId, schema.callEvents.callid],
        set: {
          status: sql`excluded.status`,
          duration: sql`coalesce(excluded.duration, ${schema.callEvents.duration},
                          case when excluded.status = 'ended'
                               then greatest(0, round(extract(epoch from (now() - ${schema.callEvents.startedAt}))))::int
                               else null end)`,
          phone: sql`excluded.phone`,
          // Once a handoff has been timed, keep it: later status updates for the
          // same call carry no agent time and shouldn't erase it.
          agentSeconds: sql`coalesce(excluded.agent_seconds, ${schema.callEvents.agentSeconds})`,
          user: sql`coalesce(excluded.user, ${schema.callEvents.user})`,
          // Ring-to-answer wait (seconds): when this update marks the call
          // 'answered', compute now - started_at (the ringing timestamp). Only
          // set it once (keep the first answered value); other updates preserve it.
          wait: sql`case
                         when excluded.wait is not null then excluded.wait
                         when excluded.status in ('answered', 'completed') and ${schema.callEvents.wait} is null
                              then greatest(0, round(extract(epoch from (now() - ${schema.callEvents.startedAt}))))::int
                         else ${schema.callEvents.wait} end`,
          // Merge raw rather than overwrite: status-update calls pass an empty
          // raw, and the inbound insert that carries {did, callerName} can race
          // behind them. Concatenating keeps existing keys so the DID is never
          // lost to ordering.
          raw: sql`${schema.callEvents.raw} || excluded.raw`
        }
      });

      // Charge, once the call has finished.
      //
      // This path writes to call_events directly — it infers a duration from
      // timestamps, preserves agent time, computes the ring-to-answer wait, none
      // of which upsertCallEvent does — so the log stays here and only the
      // charge goes to the web app, where chargeCall lives. Inbound PBX calls
      // were logged and never billed until now.
      //
      // Only on a terminal status: logCall fires on 'answered' as well, and
      // charging then would bill a call still in progress.
      if (input.status && TERMINAL_FOR_CHARGE.has(input.status)) {
        // Read the duration back rather than trusting the input: the SQL above
        // infers one from the timestamps when the caller did not supply it, and
        // that inferred value is the one to bill by.
        const [row] = await db.select({ duration: schema.callEvents.duration })
          .from(schema.callEvents)
          .where(and(eq(schema.callEvents.tenantId, input.tenantId), eq(schema.callEvents.callid, callid)))
          .limit(1);
        const seconds = row?.duration ?? input.duration ?? 0;
        if (seconds > 0) {
          const charged = await chargeViaWebApp({
            tenantId: input.tenantId, callId: callid, seconds,
            provider: input.carrier || undefined, direction: input.direction ?? 'in'
          });
          if (!charged) console.error('[call-log] logged but NOT charged:', callid);
        }
      }
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
export interface OutboundLogInput {
  agentUsername: string;
  dialed: string;
  carrier?: string;
  dialstatus?: string;
  hangupcause?: string;
  duration?: number;
  startEpoch?: number;
  callid?: string;
}

/** Report a call through the web app, so it is charged.
 *
 *  Writing straight into call_events went around upsertCallEvent, and
 *  maybeChargeCall lives inside it — so every call logged from the dialplan was
 *  recorded and never billed. Reporting here puts one path under both.
 *
 *  Returns false if it could not be reported, so the caller can fall back to the
 *  direct insert: a call logged without a charge is recoverable by
 *  reconciliation, and one not logged at all is not.
 */
async function reportToWebApp(body: Record<string, unknown>): Promise<boolean> {
  if (!INTERNAL_SECRET) return false;
  try {
    const res = await fetch(`${WEBAPP_URL}/api/internal/call-logged`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-telroi-internal': INTERNAL_SECRET },
      body: JSON.stringify(body),
      // Short: this runs inside a hangup handler, and a slow web app must not
      // hold a channel open while it tears down.
      signal: AbortSignal.timeout(4000)
    });
    return res.ok;
  } catch { return false; }
}

function mapDialStatus(s?: string, hangupcause?: string, duration?: number): string {
  switch ((s || '').toUpperCase()) {
    case 'ANSWER': return 'completed';
    case 'NOANSWER':
    case 'CANCEL': return 'missed';
    case 'BUSY':
    case 'CONGESTION':
    case 'CHANUNAVAIL':
    case 'DONTCALL':
    case 'TORTURE':
    case 'INVALIDARGS': return 'failed';
  }
  if (duration && duration > 0) return 'completed';
  const cause = Number(hangupcause);
  if (cause === 17) return 'failed';
  if (cause === 18 || cause === 19) return 'missed';
  if (cause === 0 || Number.isNaN(cause)) return 'missed';
  return 'failed';
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
      const callid = input.callid || `out-${username}-${input.startEpoch || Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const startedAt = input.startEpoch ? new Date(input.startEpoch * 1000) : new Date();
      const status = mapDialStatus(input.dialstatus, input.hangupcause, input.duration);

      // Through the web app, so the call is charged. A direct insert goes around
      // upsertCallEvent, and maybeChargeCall lives inside it — which is why not
      // one call placed through the dialplan had ever been billed.
      const reported = await reportToWebApp({
        tenantId: ep.tenantId, callid, direction: 'out',
        phone: input.dialed ? normalizePhone(input.dialed) : null,
        status, carrier: input.carrier || null,
        startedAt: startedAt.toISOString(), duration: input.duration ?? null,
        user: username,
        raw: { agent: username, dialed: input.dialed, dialstatus: input.dialstatus, hangupcause: input.hangupcause, carrier: input.carrier }
      });
      if (reported) {
        console.log(`[call-log] outbound reported: ${username} -> ${input.dialed} (${status}, ${input.duration ?? '?'}s via ${input.carrier || '?'})`);
        return;
      }

      // The web app could not be reached. Write it here anyway and say so
      // loudly: a call logged without a charge can be recovered by
      // reconciliation, and one not logged at all cannot.
      console.error('[call-log] could not reach the web app — writing directly, NOT charged:', callid);
      await db.insert(schema.callEvents).values({
        tenantId: ep.tenantId,
        callid,
        direction: 'out',
        phone: input.dialed ? normalizePhone(input.dialed) : null,
        status,
        carrier: input.carrier || null,
        startedAt,
        duration: input.duration ?? null,
        raw: { agent: username, dialed: input.dialed, dialstatus: input.dialstatus, hangupcause: input.hangupcause, carrier: input.carrier }
      }).onConflictDoUpdate({
        target: [schema.callEvents.tenantId, schema.callEvents.callid],
        set: { status: sql`excluded.status`, duration: sql`excluded.duration`, phone: sql`excluded.phone`, carrier: sql`excluded.carrier`, raw: sql`excluded.raw` }
      });
      console.log(`[call-log] outbound logged: ${username} -> ${input.dialed} (${status}, ${input.duration ?? '?'}s via ${input.carrier || '?'})`);
    } catch (err) {
      console.error('[call-log] logOutbound write failed (dropped):', (err as Error)?.message || err);
    }
  })();
}


/** Record how an OTP call actually ended. Called from the dialplan's h extension
 *  via /otp-status. A verified code is left alone: if the caller entered it
 *  before the hangup event landed, overwriting that with "delivered" would lose
 *  the more useful fact. */
export async function reportOtpStatus(otpId: string, status: string, seconds: number): Promise<void> {
  const { eq, and, ne } = await import('drizzle-orm');
  await db.update(schema.voiceOtps)
    .set({ status, reason: `${status} after ${seconds}s` })
    .where(and(eq(schema.voiceOtps.id, otpId), ne(schema.voiceOtps.status, 'verified')));
}
