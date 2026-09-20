// POST /api/auth/logout { pushToken? }
//
// Signing out stops the pushes as well as the session. An iOS device that keeps
// its token keeps receiving VoIP pushes, and PushKit requires the app to show a
// call for every one — so a signed-out iPhone rings for calls it cannot answer,
// with no SIP registration behind them. The phone has no choice about showing
// it; the only fix is to stop sending.
//
// Scoped to the device when the app names its token, because somebody signing
// out of a laptop should not silence their phone. Without one, every device
// this user holds is revoked — blunt, but better than a phone that rings for a
// workspace its owner has left.
import { and, eq, isNull } from 'drizzle-orm';
import { readSession, clearSession } from '~/server/utils/session';
import { useDb, schema } from '~/server/db';

export default defineEventHandler(async (event) => {
  const s = await readSession(event).catch(() => null);
  const body = await readBody<{ pushToken?: string }>(event).catch(() => ({} as any));

  if (s?.userId) {
    try {
      const where = [eq(schema.userDevices.userId, s.userId), isNull(schema.userDevices.revokedAt)];
      if (body?.pushToken) where.push(eq(schema.userDevices.pushToken, body.pushToken));
      await useDb().update(schema.userDevices).set({ revokedAt: new Date() }).where(and(...where));
    } catch (e) {
      // Never block a sign-out over it: somebody leaving should leave.
      console.error('[logout] devices not revoked:', (e as Error)?.message);
    }
  }

  await clearSession(event);
  return { ok: true };
});
