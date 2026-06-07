// POST /api/integrations/events { event, targetUrl, provider?, secret? }
// Subscribe a Zapier hook (or generic webhook) to a Telroi event.
import { z } from 'zod';
import { requireTenantManager, apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
import { encrypt } from '~/server/utils/crypto';
const EVENTS = ['call.completed', 'call.missed', 'call.started', 'voicemail.received', 'contact.created', 'sms.received'];
const Body = z.object({
  event: z.enum(EVENTS as [string, ...string[]]),
  targetUrl: z.string().url(),
  provider: z.string().default('zapier'),
  secret: z.string().optional()
});
export default defineEventHandler(async (event) => {
  const s = await requireTenantManager(event);
  const p = Body.safeParse(await readBody(event));
  if (!p.success) throw apiError('invalid', p.error.issues[0]?.message || 'event and a valid targetUrl are required');
  const db = useDb();
  const [row] = await db.insert(schema.integrationEvents).values({
    tenantId: s.tenantId, provider: p.data.provider, event: p.data.event,
    targetUrl: p.data.targetUrl, secretEnc: p.data.secret ? encrypt(p.data.secret) : null
  }).returning({ id: schema.integrationEvents.id });
  return { ok: true, id: row.id };
});
