// POST /api/devices { token, platform, model, appVersion }
// Registers this handset for call wake-up. Upsert on the token: reinstalling
// the app issues a new one, and the old row is swept when FCM rejects it.
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { requireTenant, apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';

const Body = z.object({
  token: z.string().min(20).max(400),
  platform: z.enum(['android', 'ios']),
  // Which APNs host this token belongs to. A TestFlight token sent to the
  // production host fails with BadDeviceToken, which reads as a dead device
  // rather than a wrong host. Android ignores it, and a build that omits it is
  // more likely a release than a debug one, so production is the safer default.
  environment: z.enum(['sandbox', 'production']).optional(),
  model: z.string().max(120).optional(),
  appVersion: z.string().max(40).optional()
});

export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  const parsed = Body.safeParse(await readBody(event));
  if (!parsed.success) throw apiError('invalid', 'A push token and platform are required');

  const db = useDb();
  const { token, platform, model, appVersion } = parsed.data;
  const environment = parsed.data.environment || 'production';

  // The same handset can move between workspaces — somebody who leaves one and
  // joins another keeps the phone. Claim the row rather than duplicating it.
  const [existing] = await db.select().from(schema.userDevices)
    .where(eq(schema.userDevices.pushToken, token)).limit(1);

  if (existing) {
    await db.update(schema.userDevices).set({
      tenantId: s.tenantId, userId: s.userId, platform, environment, model, appVersion,
      lastSeenAt: new Date(), revokedAt: null
    }).where(eq(schema.userDevices.id, existing.id));
    return { ok: true };
  }

  await db.insert(schema.userDevices).values({
    tenantId: s.tenantId, userId: s.userId, pushToken: token,
    platform, environment, model, appVersion, lastSeenAt: new Date()
  });
  return { ok: true };
});
