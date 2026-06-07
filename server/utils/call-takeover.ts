// server/utils/call-takeover.ts
// Human takeover of an AI/VAN call. Marks the call as handed off from the AI
// agent to a person: updates the call event + (if it's a Live Call widget
// session) the session, logs it, and returns the takeover intent the live media
// layer uses to drop the AI leg and bridge the human in.
//
// NOTE: the control-plane (state, routing intent, logging, billing attribution)
// is fully handled here. The actual mid-call audio swap (AI leg out, human leg
// in, same caller) executes on the telephony media layer with live provider
// credentials — that part is only exercised on the live server.
import { and, eq } from 'drizzle-orm';
import { useDb, schema } from '../db';

export interface TakeoverResult {
  ok: boolean;
  callid: string;
  takenOverBy: string;
  bridge: {
    action: 'human_takeover';
    callid: string;
    // The human leg the media layer should bridge to the caller.
    agentUserId: string;
    // The VAN/agent leg to drop, if known.
    dropAi: boolean;
  };
}

export async function takeOverCall(opts: {
  tenantId: string;
  callid: string;          // call event id ("lc_<session>" for widget calls)
  userId?: string | null;  // the human taking over (a real users.id), or null for a platform admin
  userLabel?: string;
}): Promise<TakeoverResult> {
  const db = useDb();
  const now = new Date();

  // taken_over_by_user_id / handled_by_user_id are FKs into `users`. A platform
  // admin is NOT a row in `users`, so only write the FK when we have a verified
  // users.id; otherwise attribute the takeover by label only (what the UI shows).
  const userId = await resolveRealUserId(db, opts.tenantId, opts.userId);
  const label = opts.userLabel || opts.userId || 'Agent (took over)';

  // Update the call event (the canonical call record).
  await db.update(schema.callEvents)
    .set({ handledBy: 'human', takenOverByUserId: userId, takenOverAt: now, user: label })
    .where(and(eq(schema.callEvents.tenantId, opts.tenantId), eq(schema.callEvents.callid, opts.callid)));

  // If this is a Live Call widget session (callid lc_<sessionId>), update it too.
  if (opts.callid.startsWith('lc_')) {
    const sessionId = opts.callid.slice(3);
    await db.update(schema.liveCallSessions)
      .set({ takenOverByUserId: userId, takenOverAt: now, routedTo: 'agent', handledByUserId: userId, handledByLabel: label })
      .where(and(eq(schema.liveCallSessions.id, sessionId), eq(schema.liveCallSessions.tenantId, opts.tenantId)));
  }

  // Audit log.
  try {
    const { logEvent } = await import('./logs');
    await logEvent({ tenantId: opts.tenantId, kind: 'system', action: 'call.takeover', summary: `${label} took over AI call ${opts.callid}` });
  } catch { /* */ }

  return {
    ok: true,
    callid: opts.callid,
    takenOverBy: label,
    bridge: { action: 'human_takeover', callid: opts.callid, agentUserId: userId || '', dropAi: true }
  };
}

// Returns the given id only if it's a real row in `users` (so we never violate
// the FK). Platform admins / unknown ids resolve to null.
async function resolveRealUserId(db: any, _tenantId: string, userId?: string | null): Promise<string | null> {
  if (!userId) return null;
  try {
    const [u] = await db.select({ id: schema.users.id }).from(schema.users)
      .where(eq(schema.users.id, userId)).limit(1);
    return u?.id || null;
  } catch { return null; }
}

// Calls currently handled by AI that a human could take over (live/ringing,
// routed to AI, not already taken over).
export async function activeAiCalls(tenantId: string) {
  const db = useDb();
  const rows = await db.select().from(schema.liveCallSessions)
    .where(and(eq(schema.liveCallSessions.tenantId, tenantId), eq(schema.liveCallSessions.routedTo, 'ai')));
  return rows.filter((r) => ['calling', 'connected'].includes(r.status) && !r.takenOverByUserId);
}
