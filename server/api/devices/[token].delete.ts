// DELETE /api/devices/:token — sign-out, and the only way a handset stops
// ringing. A device left registered after somebody signs out is a phone that
// rings for a workspace its holder no longer belongs to.
import { and, eq } from 'drizzle-orm';
import { requireTenant } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';

export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  const token = getRouterParam(event, 'token')!;
  await useDb().delete(schema.userDevices).where(and(
    eq(schema.userDevices.pushToken, token),
    eq(schema.userDevices.userId, s.userId)
  ));
  return { ok: true };
});
