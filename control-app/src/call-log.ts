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
