// POST /api/admin/support/devices { token, platform, model, appVersion }
//
// Registers an operator's handset for call wake-up against the support
// workspace. Without it a support call reaches the phone only while the app is
// open, which is the opposite of what a support line is for.
//
// The user id comes from userIdForAdmin because user_devices references users
// and a platform-admin id is not one.
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { requirePlatformAdmin, userIdForAdmin } from '~/server/utils/platform';
import { ensureSupportWorkspace } from '~/server/utils/support';
import { apiError } from '~/server/utils/api';
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
  const admin = await requirePlatformAdmin(event);
  const ws = await ensureSupportWorkspace();
  const parsed = Body.safeParse(await readBody(event));
  if (!parsed.success) throw apiError('invalid', 'A push token and platform are required');

  const uid = await userIdForAdmin(String((admin as any).id));
  if (!uid) throw apiError('no_user', 'Could not identify you as a user to attach a phone to.', 500);

  const db = useDb();
  const { token, platform, model, appVersion } = parsed.data;
  const environment = parsed.data.environment || 'production';

  // The same handset can move between workspaces — an operator who also uses a
  // client workspace keeps the phone. Claim the row rather than duplicating it.
  const [existing] = await db.select().from(schema.userDevices)
    .where(eq(schema.userDevices.pushToken, token)).limit(1);

  if (existing) {
    await db.update(schema.userDevices).set({
      tenantId: ws.tenantId, userId: uid, platform, environment, model, appVersion,
      lastSeenAt: new Date(), revokedAt: null
    }).where(eq(schema.userDevices.id, existing.id));
    return { ok: true };
  }

  await db.insert(schema.userDevices).values({
    tenantId: ws.tenantId, userId: uid, pushToken: token,
    platform, environment, model, appVersion, lastSeenAt: new Date()
  });
  return { ok: true };
});
