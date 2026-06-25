// POST /api/providers/:id/call { to } -> outbound click-to-call via this carrier
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { requireTenant, apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
import { decrypt } from '~/server/utils/crypto';
import { twilio, telnyx } from '~/server/utils/providers';

const Body = z.object({ to: z.string().min(3) });

export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  const id = getRouterParam(event, 'id')!;
  const p = Body.safeParse(await readBody(event));
  if (!p.success) throw apiError('invalid', 'to (number) required');

  const db = useDb();
  const [prov] = await db.select().from(schema.voiceProviders)
    .where(and(eq(schema.voiceProviders.id, id), eq(schema.voiceProviders.tenantId, s.tenantId))).limit(1);
  if (!prov?.credentialsEnc) throw apiError('not_found', 'Carrier not found', 404);
  const creds = JSON.parse(decrypt(prov.credentialsEnc));

  // Carrier-agnostic block list + channel capacity, same as the main dialer.
  const { assertNotBlacklisted } = await import('~/server/utils/blacklist');
  await assertNotBlacklisted(s.tenantId, p.data.to);
  const { isSandbox } = await import('~/server/utils/sandbox');
  if (!(await isSandbox(s.tenantId))) {
    const { assertChannelAvailable } = await import('~/server/utils/channel-limits');
    await assertChannelAvailable(s.tenantId);
  }

  const base = useRuntimeConfig().public.appBaseUrl;
  if (prov.kind === 'twilio') return await twilio.makeCall(creds, p.data.to, `${base}/api/webhooks/twilio/voice`);
  if (prov.kind === 'telnyx') return await telnyx.makeCall(creds, p.data.to);
  throw apiError('unsupported', 'Outbound not supported for this carrier');
});
