// server/utils/widget-guest.ts
// Guest SIP endpoints for Live Call widget visitors.
//
// A visitor's browser needs somewhere to register so it can be bridged to an
// agent. It gets a leased endpoint on our own PBX, in a context that permits
// exactly one extension and has no route to a trunk — the credentials travel to
// the browser in plain sight, so containment rather than secrecy is what keeps
// this safe. A captured credential can ring an agent while its lease is live,
// and nothing else, ever.
//
// Endpoints are reused rather than made per call: provisioning takes about
// twelve seconds, which no visitor should wait for. A tenant accumulates them up
// to the number of channels they pay for — the same ceiling their phone calls
// have.
import { and, eq, inArray, isNull, lt, sql } from 'drizzle-orm';
import { useDb, schema } from '~/server/db';
import { agentProvision, provisionAgentConfigured } from '~/server/utils/provision-agent';
import { encrypt, decrypt } from '~/server/utils/crypto';

const LEASE_STALE_MS = 5 * 60 * 1000;

export interface GuestLease {
  sipUsername: string;
  sipPassword: string;
  domain: string;
  endpointId: string;
}

/**
 * Reclaim endpoints whose visitor has gone. Age alone isn't enough to judge that
 * — a long conversation would have its endpoint taken mid-call and handed to
 * someone else — so only leases whose session has actually finished are freed.
 */
async function sweepStale(tenantId: string) {
  const db = useDb();
  const stale = await db.select({ id: schema.sipEndpoints.id })
    .from(schema.sipEndpoints)
    .innerJoin(schema.liveCallSessions, eq(schema.liveCallSessions.id, schema.sipEndpoints.leasedSessionId))
    .where(and(
      eq(schema.sipEndpoints.tenantId, tenantId),
      eq(schema.sipEndpoints.kind, 'widget_guest'),
      lt(schema.sipEndpoints.leasedAt, new Date(Date.now() - LEASE_STALE_MS)),
      inArray(schema.liveCallSessions.status, ['ended', 'missed'])
    ));
  if (stale.length) {
    await db.update(schema.sipEndpoints)
      .set({ leasedSessionId: null, leasedAt: null })
      .where(inArray(schema.sipEndpoints.id, stale.map((r) => r.id)));
  }
}

export async function leaseGuestEndpoint(tenantId: string, sessionId: string, maxEndpoints: number): Promise<GuestLease | null> {
  const db = useDb();
  await sweepStale(tenantId);

  const [mine] = await db.select().from(schema.sipEndpoints)
    .where(and(
      eq(schema.sipEndpoints.tenantId, tenantId),
      eq(schema.sipEndpoints.kind, 'widget_guest'),
      eq(schema.sipEndpoints.leasedSessionId, sessionId)
    )).limit(1);
  if (mine?.sipUsername && mine.secretEnc) {
    return { sipUsername: mine.sipUsername, sipPassword: decrypt(mine.secretEnc), domain: mine.domain || '', endpointId: mine.id };
  }

  // The conditional update is the lock: two visitors racing for the last free
  // endpoint means one update matches and the other finds nothing.
  const [free] = await db.select().from(schema.sipEndpoints)
    .where(and(
      eq(schema.sipEndpoints.tenantId, tenantId),
      eq(schema.sipEndpoints.kind, 'widget_guest'),
      isNull(schema.sipEndpoints.leasedSessionId)
    )).limit(1);

  if (free) {
    const claimed = await db.update(schema.sipEndpoints)
      .set({ leasedSessionId: sessionId, leasedAt: new Date() })
      .where(and(eq(schema.sipEndpoints.id, free.id), isNull(schema.sipEndpoints.leasedSessionId)))
      .returning();
    if (claimed.length && claimed[0].sipUsername && claimed[0].secretEnc) {
      return { sipUsername: claimed[0].sipUsername, sipPassword: decrypt(claimed[0].secretEnc), domain: claimed[0].domain || '', endpointId: claimed[0].id };
    }
  }

  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.sipEndpoints)
    .where(and(eq(schema.sipEndpoints.tenantId, tenantId), eq(schema.sipEndpoints.kind, 'widget_guest')));
  if (n >= maxEndpoints) return null;
  if (!provisionAgentConfigured()) return null;

  const result = await agentProvision(tenantId, `widget-guest-${n + 1}`, true, 'widget-guest');
  const [row] = await db.insert(schema.sipEndpoints).values({
    tenantId, provider: 'telroi', kind: 'widget_guest',
    externalId: result.username, label: `widget-guest-${n + 1}`, sipUsername: result.username,
    secretEnc: encrypt(result.password), domain: result.domain,
    meta: { webrtc: true, guest: true, context: 'widget-guest' },
    leasedSessionId: sessionId, leasedAt: new Date()
  }).returning();

  return { sipUsername: row.sipUsername!, sipPassword: result.password, domain: row.domain || '', endpointId: row.id };
}

/**
 * Make sure this tenant has at least one guest endpoint, provisioning one if not.
 * Called in the background when a widget's config is fetched, so an endpoint is
 * waiting long before anyone clicks to call — provisioning takes the better part
 * of a minute, which no visitor should ever sit through.
 */
export async function ensureGuestEndpoint(tenantId: string): Promise<void> {
  const db = useDb();
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.sipEndpoints)
    .where(and(eq(schema.sipEndpoints.tenantId, tenantId), eq(schema.sipEndpoints.kind, 'widget_guest')));
  if (n > 0) return;
  if (!provisionAgentConfigured()) return;

  const result = await agentProvision(tenantId, 'widget-guest-1', true, 'widget-guest');
  await db.insert(schema.sipEndpoints).values({
    tenantId, provider: 'telroi', kind: 'widget_guest',
    externalId: result.username, label: 'widget-guest-1', sipUsername: result.username,
    secretEnc: encrypt(result.password), domain: result.domain,
    meta: { webrtc: true, guest: true, context: 'widget-guest' }
  });
}

export async function releaseGuestEndpoint(sessionId: string) {
  await useDb().update(schema.sipEndpoints)
    .set({ leasedSessionId: null, leasedAt: null })
    .where(eq(schema.sipEndpoints.leasedSessionId, sessionId));
}
