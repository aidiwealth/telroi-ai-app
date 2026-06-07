// POST /api/cron/followups  (header: x-cron-secret: $CRON_SECRET)
// Inactivity follow-up runner. Sends a 48-hour and a 1-week nudge to workspaces
// that have done NO real system action since signup (no top-up, no number, no
// VAN, etc.). Tracks sends on the tenant so it never double-sends, and skips
// anyone who has unsubscribed. Designed to be hit by an external scheduler
// (cron / DigitalOcean scheduled job) once an hour or once a day.
//
// "Active" = lastActivityAt is set (we bump it on real actions), OR the tenant
// already owns ledger/vans/number rows (covers pre-existing activity).
import { and, eq, isNull, lte, isNotNull, or } from 'drizzle-orm';
import { useDb, schema } from '~/server/db';
import { sendFollowup48Email, sendFollowup1wEmail } from '~/server/utils/email';

export default defineEventHandler(async (event) => {
  const secret = (useRuntimeConfig() as any).cronSecret;
  const given = getHeader(event, 'x-cron-secret');
  // If a secret is configured, require it. (If not set, allow platform admins.)
  if (secret) {
    if (given !== secret) throw createError({ statusCode: 401, statusMessage: 'bad cron secret' });
  } else {
    const { requirePlatformAdmin } = await import('~/server/utils/platform');
    await requirePlatformAdmin(event);
  }

  const db = useDb();
  const now = Date.now();
  const H48 = new Date(now - 48 * 3600 * 1000);
  const D7 = new Date(now - 7 * 24 * 3600 * 1000);

  // Candidate tenants: not internal, not unsubscribed, no recorded activity.
  const tenants = await db.select().from(schema.tenants).where(and(
    eq(schema.tenants.isInternal, false),
    isNull(schema.tenants.lastActivityAt),
    isNull(schema.tenants.emailUnsubscribedAt)
  ));

  let sent48 = 0, sent1w = 0;
  for (const t of tenants) {
    // Double-check no real activity exists (ledger / vans / numbers), in case
    // lastActivityAt predates the tracking column.
    const [led] = await db.select({ id: schema.ledger.id }).from(schema.ledger).where(eq(schema.ledger.tenantId, t.id)).limit(1);
    if (led) continue;
    const [van] = await db.select({ id: schema.vans.id }).from(schema.vans).where(eq(schema.vans.tenantId, t.id)).limit(1);
    if (van) continue;
    const [num] = await db.select({ id: schema.numberSubscriptions.id }).from(schema.numberSubscriptions).where(eq(schema.numberSubscriptions.tenantId, t.id)).limit(1);
    if (num) continue;

    // Resolve the owner's email.
    const [owner] = await db.select({ email: schema.users.email })
      .from(schema.memberships)
      .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
      .where(and(eq(schema.memberships.tenantId, t.id), eq(schema.memberships.role, 'owner')))
      .limit(1);
    if (!owner?.email) continue;

    const created = t.createdAt ? new Date(t.createdAt).getTime() : now;

    // 1-week nudge (only after the 48h one, and once).
    if (created <= D7.getTime() && !t.followup1wSentAt) {
      try {
        await sendFollowup1wEmail(owner.email, { workspace: t.name, name: owner.email.split('@')[0], unsubToken: t.unsubToken || undefined });
        await db.update(schema.tenants).set({ followup1wSentAt: new Date() }).where(eq(schema.tenants.id, t.id));
        sent1w++;
      } catch (e) { console.error('[cron] 1w followup failed', t.id, e); }
      continue;
    }
    // 48-hour nudge (once).
    if (created <= H48.getTime() && !t.followup48SentAt) {
      try {
        await sendFollowup48Email(owner.email, { workspace: t.name, name: owner.email.split('@')[0], unsubToken: t.unsubToken || undefined });
        await db.update(schema.tenants).set({ followup48SentAt: new Date() }).where(eq(schema.tenants.id, t.id));
        sent48++;
      } catch (e) { console.error('[cron] 48h followup failed', t.id, e); }
    }
  }

  return { ok: true, sent48, sent1w, scanned: tenants.length };
});
