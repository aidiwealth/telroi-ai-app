// POST /api/webhook-endpoints { url, events[] } -> tell us where to send events.
//
// The signing secret is generated here and shown once: we keep only what we need
// to sign with, and a secret we can read back to a browser is one an attacker can
// read too.
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { requireTenant, apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
import { encrypt } from '~/server/utils/crypto';
import { randomBytes } from 'node:crypto';

const Body = z.object({
  url: z.string().url().refine((u) => u.startsWith('https://'), 'The URL must be https'),
  events: z.array(z.string()).min(1, 'Choose at least one event')
});

export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  if (s.role && !['owner', 'admin'].includes(s.role)) {
    throw apiError('forbidden', 'Only workspace owners or admins can change webhooks.', 403);
  }
  const p = Body.safeParse(await readBody(event));
  if (!p.success) throw apiError('invalid', p.error.issues[0]?.message || 'A URL and at least one event are required');

  const db = useDb();
  const existing = await db.select().from(schema.webhookEndpoints)
    .where(and(eq(schema.webhookEndpoints.tenantId, s.tenantId), eq(schema.webhookEndpoints.url, p.data.url)));
  if (existing.length) throw apiError('exists', 'That URL is already configured.', 409);

  const secret = 'whsec_' + randomBytes(24).toString('hex');
  const [row] = await db.insert(schema.webhookEndpoints).values({
    tenantId: s.tenantId, url: p.data.url, events: p.data.events, secretEnc: encrypt(secret)
  }).returning();

  return { endpoint: { id: row.id, url: row.url, events: row.events }, secret };
});
