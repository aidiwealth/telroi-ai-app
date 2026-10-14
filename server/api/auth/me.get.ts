// GET /api/auth/me -> current session + tenant summary
import { readSession } from '~/server/utils/session';
import { useDb, schema } from '~/server/db';
import { and, eq } from 'drizzle-orm';

export default defineEventHandler(async (event) => {
  const s = await readSession(event);
  if (!s) return { user: null };
  const db = useDb();

  // Validate the session actually points at a real user. After a DB reset (or if
  // the user was deleted), a leftover cookie would otherwise look "logged in"
  // with no valid workspace and wrongly route to onboarding/setup. Treat a
  // missing user as logged-out and clear the stale cookie.
  const [u] = await db.select().from(schema.users).where(eq(schema.users.id, s.userId)).limit(1);
  if (!u) {
    const { clearSession } = await import('~/server/utils/session');
    await clearSession(event);
    return { user: null };
  }

  // Everything below this point is decoration, and decoration must not cost a
  // session. This endpoint runs on every page load and the auth guard treats a
  // failure as logged-out — so one query throwing on a new user's empty tenant
  // sent every signup back to the login page for six days, with nothing to say
  // why. Each lookup is wrapped: a fault logs and returns nothing, and the
  // person stays signed in.
  let tenant = null;
  if (s.tenantId) {
    try {
      const [t] = await db.select().from(schema.tenants).where(eq(schema.tenants.id, s.tenantId)).limit(1);
      if (t) tenant = { id: t.id, name: t.name, slug: t.slug, timezone: t.timezone, country: t.country, onboardingStep: t.onboardingStep, provisioned: !!t.telroiApiKeyEnc, sandbox: t.sandboxMode, subAccountsEnabled: !!t.subAccountsEnabled };
    } catch (e) {
      console.error('[me] tenant lookup failed:', (e as Error)?.message);
    }
  }
  // When this person last looked at their missed calls. The apps filter the
  // call list themselves, so they count against this rather than us returning
  // a number they would then have to reconcile with their own filtering.
  // Only when there is a tenant. A new user has none until onboarding creates
  // one, and an empty string is not a uuid — Postgres threw, me returned 500,
  // and the auth guard read that as logged-out and sent them back to the login
  // page moments after their code was accepted.
  let seen: any = null;
  if (s.tenantId) {
    try {
      [seen] = await db.select().from(schema.missedSeen)
        .where(and(eq(schema.missedSeen.tenantId, s.tenantId),
                   eq(schema.missedSeen.userId, s.userId))).limit(1);
    } catch (e) {
      console.error('[me] missed-seen lookup failed:', (e as Error)?.message);
    }
  }

  return { user: { id: s.userId, email: s.email, role: s.role, name: u.name || null, copilotOnboarded: !!u.copilotOnboarded, missedSeenAt: seen?.seenAt || null, impersonatedBy: s.impersonatedBy || null }, tenant };
});
