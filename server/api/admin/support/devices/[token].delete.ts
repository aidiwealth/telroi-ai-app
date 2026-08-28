// DELETE /api/admin/support/devices/:token — sign-out, and the only way an
// operator's handset stops ringing for the support workspace.
//
// Scoped to the owner as well as the token: a token is not a secret worth
// trusting on its own, and unregistering somebody else's phone should not be
// possible by holding one.
import { and, eq } from 'drizzle-orm';
import { requirePlatformAdmin, userIdForAdmin } from '~/server/utils/platform';
import { apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';

export default defineEventHandler(async (event) => {
  const admin = await requirePlatformAdmin(event);
  const token = getRouterParam(event, 'token')!;

  const uid = await userIdForAdmin(String((admin as any).id));
  if (!uid) throw apiError('no_user', 'Could not identify you as a user.', 500);

  await useDb().delete(schema.userDevices).where(and(
    eq(schema.userDevices.pushToken, token),
    eq(schema.userDevices.userId, uid)
  ));
  return { ok: true };
});
