// POST /api/copilot/onboarded — mark the current user as having seen the copilot
// welcome, so the onboarding auto-open fires exactly once per account.
import { readSession } from '~/server/utils/session';
import { useDb, schema } from '~/server/db';
import { eq } from 'drizzle-orm';

export default defineEventHandler(async (event) => {
  const s = await readSession(event);
  if (!s) return { ok: false };
  await useDb().update(schema.users).set({ copilotOnboarded: true }).where(eq(schema.users.id, s.userId));
  return { ok: true };
});
