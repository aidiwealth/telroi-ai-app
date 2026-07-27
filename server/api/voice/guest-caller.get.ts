// GET /api/voice/guest-caller?username=tnt_xxx -> who is on this guest endpoint.
// A widget call reaches the PBX as its guest endpoint's username, which tells an
// agent nothing. The lease knows which visitor holds it, so the control-app asks
// here before ringing and shows their name instead.
import { and, eq, isNotNull } from 'drizzle-orm';
import { useDb, schema } from '~/server/db';

export default defineEventHandler(async (event) => {
  const cfg = useRuntimeConfig() as any;
  const secret = (cfg.internalSecret as string) || (cfg.provisionAgentSecret as string) || '';
  const given = getHeader(event, 'x-telroi-internal') || '';
  if (!secret || given !== secret) throw createError({ statusCode: 401, statusMessage: 'unauthorized' });

  const username = String(getQuery(event).username || '').trim();
  if (!username) return { name: null };

  const db = useDb();
  const [row] = await db.select({ name: schema.liveCallSessions.visitorName, phone: schema.liveCallSessions.visitorPhone })
    .from(schema.sipEndpoints)
    .innerJoin(schema.liveCallSessions, eq(schema.liveCallSessions.id, schema.sipEndpoints.leasedSessionId))
    .where(and(eq(schema.sipEndpoints.sipUsername, username), isNotNull(schema.sipEndpoints.leasedSessionId)))
    .limit(1);

  return { name: row?.name || null, phone: row?.phone || null };
});
