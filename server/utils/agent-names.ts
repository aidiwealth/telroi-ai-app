// server/utils/agent-names.ts
// Resolve agent SIP usernames (memberships.pbx_login) to the person's display
// name, so call lists/exports show "Ada" rather than "tnt_ab12cd34". Mutates
// each row in place, setting `user_name`. Best-effort — never throws.
import { and, eq, inArray } from 'drizzle-orm';
import { useDb, schema } from '../db';

export async function resolveAgentNames(tenantId: string, list: any[]): Promise<void> {
  try {
    const logins = Array.from(new Set((list || []).map((c) => c.user).filter(Boolean)));
    if (!logins.length) return;
    const rows = await useDb().select({
      pbxLogin: schema.memberships.pbxLogin,
      name: schema.users.name,
      email: schema.users.email
    }).from(schema.memberships)
      .innerJoin(schema.users, eq(schema.memberships.userId, schema.users.id))
      .where(and(eq(schema.memberships.tenantId, tenantId), inArray(schema.memberships.pbxLogin, logins as string[])));
    const byLogin = new Map(rows.map((r) => [r.pbxLogin, r.name || r.email || undefined]));
    for (const c of list) {
      if (c.user && byLogin.get(c.user)) c.user_name = byLogin.get(c.user);
    }
  } catch { /* best-effort */ }
}
