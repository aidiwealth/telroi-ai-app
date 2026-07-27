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
import { and, eq, isNull, lt, sql } from 'drizzle-orm';
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

async function sweepStale(tenantId: string) {
  const db = useDb();
  await db.update(schema.sipEndpoints)
    .set({ leasedSessionId: null, leasedAt: null })
    .where(and(
      eq(schema.sipEndpoints.tenantId, tenantId),
      eq(schema.sipEndpoints.kind, 'widget_guest'),
      lt(schema.sipEndpoints.leasedAt, new Date(Date.now() - LEASE_STALE_MS))
    ));
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

export async function releaseGuestEndpoint(sessionId: string) {
  await useDb().update(schema.sipEndpoints)
    .set({ leasedSessionId: null, leasedAt: null })
    .where(eq(schema.sipEndpoints.leasedSessionId, sessionId));
}
