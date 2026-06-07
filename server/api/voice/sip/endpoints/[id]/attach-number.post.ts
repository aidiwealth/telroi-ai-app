// POST /api/voice/sip/endpoints/:id/attach-number { telnum } -> explicitly route
// one of the client's existing numbers over this SIP endpoint. Deliberate action
// (never automatic) so we don't silently re-route live inbound traffic.
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { requireTenant, apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
import { masterCarrierCreds } from '~/server/utils/platform';
import { twilio, telnyx } from '~/server/utils/providers';
import { logEvent } from '~/server/utils/logs';

const Body = z.object({ telnum: z.string().min(3) });

export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  if (s.role && !['owner', 'admin'].includes(s.role)) {
    throw apiError('forbidden', 'Only workspace owners or admins can route numbers over SIP.', 403);
  }
  const id = getRouterParam(event, 'id')!;
  const p = Body.safeParse(await readBody(event));
  if (!p.success) throw apiError('invalid', 'A number is required');

  const db = useDb();
  const [ep] = await db.select().from(schema.sipEndpoints)
    .where(and(eq(schema.sipEndpoints.id, id), eq(schema.sipEndpoints.tenantId, s.tenantId))).limit(1);
  if (!ep) throw apiError('not_found', 'SIP endpoint not found', 404);

  const creds = await masterCarrierCreds();
  if (ep.provider === 'twilio') {
    if (!creds?.twilio || !ep.externalId) throw apiError('not_configured', 'Twilio is not configured.', 503);
    const res = await twilio.attachNumberToTrunk(creds.twilio, ep.externalId, p.data.telnum);
    await logEvent({ tenantId: s.tenantId, kind: 'system', action: 'sip.attach_number', summary: `Routed ${p.data.telnum} over Twilio trunk` });
    return { ok: true, ...res };
  }
  if (ep.provider === 'telnyx') {
    if (!creds?.telnyx || !ep.externalId) throw apiError('not_configured', 'Telnyx is not configured.', 503);
    const res = await telnyx.attachNumberToConnection(creds.telnyx, ep.externalId, p.data.telnum);
    await logEvent({ tenantId: s.tenantId, kind: 'system', action: 'sip.attach_number', summary: `Routed ${p.data.telnum} to Telnyx connection` });
    return { ok: true, ...res };
  }
  throw apiError('unsupported', `Routing a number over ${ep.provider} from here isn’t wired yet — assign it in your number settings.`, 400);
});
