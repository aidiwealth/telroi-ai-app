// POST /api/account/email/confirm { email, code } -> verify the code sent to the
// new email and switch the user's address.
import { z } from 'zod';
import { eq, and, isNull, gt, desc } from 'drizzle-orm';
import { requireUser, apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
import { sha256 } from '~/server/utils/crypto';
import { logEvent } from '~/server/utils/logs';

const Body = z.object({ email: z.string().email(), code: z.string().regex(/^\d{6}$/) });

export default defineEventHandler(async (event) => {
  const s = await requireUser(event);
  const p = Body.safeParse(await readBody(event));
  if (!p.success) throw apiError('invalid', 'Email and 6-digit code required');
  const db = useDb();
  const email = p.data.email.trim().toLowerCase();

  const [row] = await db.select().from(schema.authTokens)
    .where(and(eq(schema.authTokens.email, email), isNull(schema.authTokens.consumedAt), gt(schema.authTokens.expiresAt, new Date())))
    .orderBy(desc(schema.authTokens.createdAt)).limit(1);
  if (!row) throw apiError('expired', 'Code expired — request a new one', 400);
  if (row.attempts >= 5) throw apiError('locked', 'Too many attempts — request a new code', 429);
  if (row.otpHash !== sha256(p.data.code)) {
    await db.update(schema.authTokens).set({ attempts: row.attempts + 1 }).where(eq(schema.authTokens.id, row.id));
    throw apiError('wrong_code', 'Incorrect code', 400);
  }

  // Double-check the email is still free, then switch.
  const [taken] = await db.select().from(schema.users).where(eq(schema.users.email, email)).limit(1);
  if (taken && taken.id !== s.userId) throw apiError('exists', 'That email is already in use');

  await db.update(schema.authTokens).set({ consumedAt: new Date() }).where(eq(schema.authTokens.id, row.id));
  await db.update(schema.users).set({ email }).where(eq(schema.users.id, s.userId));
  await logEvent({ tenantId: s.tenantId, kind: 'system', action: 'account.email_changed', summary: `Email changed to ${email}` });
  return { ok: true, email };
});
