// GET /api/auth/me -> current session + tenant summary
import { readSession } from '~/server/utils/session';
import { useDb, schema } from '~/server/db';
import { eq } from 'drizzle-orm';

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
    clearSession(event);
    return { user: null };
  }

  let tenant = null;
  if (s.tenantId) {
    const [t] = await db.select().from(schema.tenants).where(eq(schema.tenants.id, s.tenantId)).limit(1);
    if (t) tenant = { id: t.id, name: t.name, slug: t.slug, timezone: t.timezone, country: t.country, onboardingStep: t.onboardingStep, provisioned: !!t.telroiApiKeyEnc, sandbox: t.sandboxMode };
  }
  return { user: { id: s.userId, email: s.email, role: s.role, name: u.name || null, copilotOnboarded: !!u.copilotOnboarded }, tenant };
});
