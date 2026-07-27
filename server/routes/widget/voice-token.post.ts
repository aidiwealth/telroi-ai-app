// POST /widget/voice-token { key, sessionId }
// Lend this visitor a guest SIP endpoint so their browser can register and be
// bridged to an agent.
//
// The credentials go to a browser, so they are public the moment they're issued.
// What protects this is what a guest can reach: one extension, no trunk, one
// tenant. The lease is the gate — rate-limited, tied to a live session, and
// reclaimed when the call ends or the browser disappears.
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { useDb, schema } from '~/server/db';
import { tenantByWidgetKey } from '~/server/utils/live-call';
import { rateLimit, clientIp } from '~/server/utils/api';
import { leaseGuestEndpoint } from '~/server/utils/widget-guest';

const Body = z.object({ key: z.string(), sessionId: z.string().uuid() });

export default defineEventHandler(async (event) => {
  setHeader(event, 'Access-Control-Allow-Origin', '*');
  const p = Body.safeParse(await readBody(event));
  if (!p.success) { setResponseStatus(event, 400); return { error: 'invalid' }; }

  const ip = clientIp(event);
  // Cheap to ask for, so worth capping: an endpoint held is an endpoint another
  // visitor can't have.
  rateLimit('widget_token_ip', ip, 5, 60_000);
  rateLimit('widget_token_key', p.data.key, 20, 60_000);

  let t: any = null;
  try { t = await tenantByWidgetKey(p.data.key); } catch { /* */ }
  if (!t) { setResponseStatus(event, 404); return { error: 'invalid_key' }; }

  // The session must be real, this tenant's, and still going.
  const db = useDb();
  const [sess] = await db.select().from(schema.liveCallSessions)
    .where(and(eq(schema.liveCallSessions.id, p.data.sessionId), eq(schema.liveCallSessions.tenantId, t.id)))
    .limit(1);
  if (!sess || ['ended', 'missed'].includes(sess.status)) {
    setResponseStatus(event, 409); return { error: 'session_closed' };
  }

  // How many guests this tenant may hold at once: the channels they pay for.
  // Internal workspaces (our own support desk) aren't metered.
  let maxEndpoints = 1;
  try {
    if (t.isInternal) {
      maxEndpoints = 50;
    } else {
      const subs = await db.select({ channels: schema.numberSubscriptions.channels })
        .from(schema.numberSubscriptions)
        .where(and(eq(schema.numberSubscriptions.tenantId, t.id), eq(schema.numberSubscriptions.status, 'active')));
      maxEndpoints = Math.max(1, subs.reduce((sum, s) => sum + (s.channels || 1), 0));
    }
  } catch { /* fall back to one */ }

  const lease = await leaseGuestEndpoint(t.id, p.data.sessionId, maxEndpoints);
  if (!lease) { setResponseStatus(event, 503); return { error: 'no_capacity' }; }

  const sipDomain = lease.domain || process.env.SIP_DOMAIN || 'sip.telroi.ai';
  return {
    ok: true,
    provider: 'telroi',
    sipUsername: lease.sipUsername,
    sipPassword: lease.sipPassword,
    sipDomain,
    wsServer: `wss://${sipDomain}:8089/ws`,
    // The only extension a guest is permitted to dial.
    destination: 'connect'
  };
});
