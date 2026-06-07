// POST /api/admin/webhooks { enabled?, telnyxSecret?, pbxSecret?, twilioSecret? }
// Saves inbound webhook toggles + signing secrets (encrypted). Superadmin only.
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { requirePlatformAdmin } from '~/server/utils/platform';
import { apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
import { encrypt } from '~/server/utils/crypto';

const Body = z.object({
  enabled: z.object({ twilio: z.boolean().optional(), telnyx: z.boolean().optional(), pbx: z.boolean().optional(), sotel: z.boolean().optional(), asterisk: z.boolean().optional(), ruach: z.boolean().optional() }).optional(),
  telnyxSecret: z.string().optional(),
  pbxSecret: z.string().optional(),
  twilioSecret: z.string().optional(),
  sotelSecret: z.string().optional(),
  asteriskSecret: z.string().optional(),
  ruachSecret: z.string().optional()
});

export default defineEventHandler(async (event) => {
  const admin = await requirePlatformAdmin(event);
  if (admin.role !== 'superadmin') throw apiError('forbidden', 'Superadmin required', 403);
  const p = Body.safeParse(await readBody(event));
  if (!p.success) throw apiError('invalid', 'Invalid webhook config');
  const db = useDb();
  const [s] = await db.select().from(schema.platformSettings).limit(1);

  const patch: any = {};
  if (p.data.enabled) patch.inboundWebhooksEnabled = { ...((s?.inboundWebhooksEnabled as any) || {}), ...p.data.enabled };
  if (p.data.telnyxSecret) patch.telnyxWebhookSecretEnc = encrypt(p.data.telnyxSecret);
  if (p.data.pbxSecret) patch.pbxWebhookSecretEnc = encrypt(p.data.pbxSecret);
  if (p.data.twilioSecret) patch.twilioWebhookSecretEnc = encrypt(p.data.twilioSecret);
  if (p.data.sotelSecret) patch.sotelWebhookSecretEnc = encrypt(p.data.sotelSecret);
  if (p.data.asteriskSecret) patch.asteriskWebhookSecretEnc = encrypt(p.data.asteriskSecret);
  if (p.data.ruachSecret) patch.ruachWebhookSecretEnc = encrypt(p.data.ruachSecret);

  if (s) await db.update(schema.platformSettings).set(patch).where(eq(schema.platformSettings.id, s.id));
  else await db.insert(schema.platformSettings).values({ id: 'singleton', ...patch });
  return { ok: true };
});
