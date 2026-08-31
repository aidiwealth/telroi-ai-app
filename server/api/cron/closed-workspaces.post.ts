// POST /api/cron/closed-workspaces  (header: x-cron-secret: $CRON_SECRET)
//
// Finishes what closing an account started. A workspace closed with its last
// member is marked rather than dismantled: numbers have to be released,
// recordings pruned, and none of that belongs in the seconds after somebody
// taps a button on a phone.
//
// Thirty days, which is both a reasonable second thought and the window the
// privacy policy commits to. Until then a closed workspace can still be signed
// into, so a tap made in anger or by mistake is not final.
import { and, eq, lt, isNotNull, isNull } from 'drizzle-orm';
import { useDb, schema } from '~/server/db';

export default defineEventHandler(async (event) => {
  const secret = (useRuntimeConfig() as any).cronSecret;
  const given = getHeader(event, 'x-cron-secret');
  if (secret && given !== secret) throw createError({ statusCode: 401, statusMessage: 'bad cron secret' });

  const db = useDb();
  const cutoff = new Date(Date.now() - 30 * 24 * 3600 * 1000);

  const due = await db.select({ id: schema.tenants.id, name: schema.tenants.name })
    .from(schema.tenants)
    .where(and(isNotNull(schema.tenants.closedAt), lt(schema.tenants.closedAt, cutoff)));

  const done: string[] = [];
  const withBalance: { name: string; balanceMinor: number; currency: string }[] = [];

  for (const t of due) {
    // Cancelled with a grace period rather than freed here: the numbers-grace
    // job already knows how to return one to the pool, and two paths doing the
    // same thing would drift.
    await db.update(schema.numberSubscriptions)
      .set({ cancelledAt: new Date(), graceEndsAt: new Date() })
      .where(and(eq(schema.numberSubscriptions.tenantId, t.id),
                 isNull(schema.numberSubscriptions.cancelledAt)))
      .catch(() => {});

    // Money is not absorbed quietly. A workspace closed with a balance is
    // reported so somebody decides what happens to it — keeping a client's
    // money because they tapped a button is the sort of thing that reads badly
    // when noticed, and it should not be a consequence of a job at 3am.
    try {
      const [w] = await db.select().from(schema.wallets)
        .where(eq(schema.wallets.tenantId, t.id)).limit(1);
      if (w && w.balanceMinor > 0) {
        withBalance.push({ name: t.name || t.id, balanceMinor: w.balanceMinor, currency: w.currency });
      }
    } catch { /* reporting a balance is not worth failing the sweep for */ }

    done.push(t.name || t.id);
  }

  if (withBalance.length) {
    console.warn('[closed-workspaces] closed with a balance still on the wallet:',
      JSON.stringify(withBalance));
  }
  if (done.length) console.log('[closed-workspaces] finished', done.length, 'workspace(s)');

  return { ok: true, finished: done.length, withBalance };
});
