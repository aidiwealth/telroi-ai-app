// POST /api/admin/signup-apology
//
// One-off: the signups bounced back to the login page between 11 and 17
// September. A fault in /api/auth/me returned a 500 for any user with no
// workspace yet, and the guard read that as being logged out — so thirteen
// people entered a valid code and were sent back to sign in with nothing to
// tell them why.
//
// Selects on the same condition rather than a hardcoded list: a user with no
// membership created in that window is exactly who was affected.
import { and, eq, gt, isNull, lt } from 'drizzle-orm';
import { requireSuperAdmin } from '~/server/utils/platform';
import { useDb, schema } from '~/server/db';

export default defineEventHandler(async (event) => {
  await requireSuperAdmin(event);
  const db = useDb();

  const rows = await db.select({ email: schema.users.email })
    .from(schema.users)
    .leftJoin(schema.memberships, eq(schema.memberships.userId, schema.users.id))
    .where(and(
      isNull(schema.memberships.userId),
      gt(schema.users.createdAt, new Date('2026-09-11T00:00:00Z')),
      lt(schema.users.createdAt, new Date('2026-09-18T00:00:00Z'))
    ));

  const { sendSignupApologyEmail } = await import('~/server/utils/email');
  const sent: string[] = [];
  const failed: string[] = [];
  for (const r of rows) {
    if (!r.email) continue;
    try { await sendSignupApologyEmail(r.email); sent.push(r.email); }
    catch (e: any) { failed.push(`${r.email}: ${e?.message || e}`); }
  }
  return { ok: true, count: sent.length, sent, failed };
});
