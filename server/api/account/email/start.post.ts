// POST /api/account/email/start { email } -> send a 6-digit code to the NEW
// email so the user can prove they own it before we switch their address.
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { requireUser, apiError, rateLimit } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
import { sha256, randomToken, randomOtp } from '~/server/utils/crypto';
import { sendLoginEmail } from '~/server/utils/email';

const Body = z.object({ email: z.string().email() });

export default defineEventHandler(async (event) => {
  const s = await requireUser(event);
  const p = Body.safeParse(await readBody(event));
  if (!p.success) throw apiError('invalid', 'A valid email is required');
  const db = useDb();
  const email = p.data.email.trim().toLowerCase();
  rateLimit('email-change', s.userId, 5, 600_000);

  if (email === s.email.toLowerCase()) throw apiError('invalid', 'That is already your email');
  const [taken] = await db.select().from(schema.users).where(eq(schema.users.email, email)).limit(1);
  if (taken) throw apiError('exists', 'That email is already in use');

  const otp = randomOtp();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
  // Store under the NEW email; purpose 'login' (only enum value). The confirm
  // step matches on this email + code, so it can't be reused for sign-in.
  await db.insert(schema.authTokens).values({
    email, tokenHash: sha256(randomToken()), otpHash: sha256(otp), purpose: 'login', expiresAt
  });
  await sendLoginEmail(email, '', otp); // OTP-only; no magic link needed here
  return { ok: true };
});
