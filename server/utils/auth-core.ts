// server/utils/auth-core.ts
// Core passwordless logic shared by the auth routes.
import { and, eq, gt, isNull, desc } from 'drizzle-orm';
import { useDb, schema } from '../db';
import { sha256, safeEqualHex, randomToken, randomOtp } from './crypto';
import { sendLoginEmail } from './email';
import { issueSession } from './session';
import type { H3Event } from 'h3';

const TOKEN_TTL_MS = 10 * 60 * 1000; // 10 minutes
const MAX_OTP_ATTEMPTS = 5;

export async function startLogin(email: string) {
  const db = useDb();
  const normalized = email.trim().toLowerCase();
  const token = randomToken();
  const otp = randomOtp();
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);

  // Invalidate any prior un-consumed codes for this email so only the newest is
  // ever valid (prevents a backlog of guessable live codes).
  await db.update(schema.authTokens).set({ consumedAt: new Date() })
    .where(and(eq(schema.authTokens.email, normalized), isNull(schema.authTokens.consumedAt)));

  await db.insert(schema.authTokens).values({
    email: normalized,
    tokenHash: sha256(token),
    otpHash: sha256(otp),
    purpose: 'login',
    expiresAt
  });

  const base = useRuntimeConfig().public.appBaseUrl;
  // The magic link hits the server verifier directly, which validates the token,
  // sets the session cookie, and redirects to the dashboard or onboarding.
  const magicLink = `${base}/api/auth/magic?token=${encodeURIComponent(token)}`;
  await sendLoginEmail(normalized, magicLink, otp);
}

/** Verify a magic-link token. Returns the email on success. */
export async function verifyToken(token: string): Promise<string> {
  const db = useDb();
  const hash = sha256(token);
  const [row] = await db
    .select()
    .from(schema.authTokens)
    .where(and(eq(schema.authTokens.tokenHash, hash), isNull(schema.authTokens.consumedAt), gt(schema.authTokens.expiresAt, new Date())))
    .orderBy(desc(schema.authTokens.createdAt))
    .limit(1);
  if (!row) throw createError({ statusCode: 400, message: 'Invalid or expired link' });
  await db.update(schema.authTokens).set({ consumedAt: new Date() }).where(eq(schema.authTokens.id, row.id));
  return row.email;
}

/** Verify an OTP code for an email. Returns the email on success. */
export async function verifyOtp(email: string, code: string): Promise<string> {
  const db = useDb();
  const normalized = email.trim().toLowerCase();
  const [row] = await db
    .select()
    .from(schema.authTokens)
    .where(and(eq(schema.authTokens.email, normalized), isNull(schema.authTokens.consumedAt), gt(schema.authTokens.expiresAt, new Date())))
    .orderBy(desc(schema.authTokens.createdAt))
    .limit(1);
  if (!row) throw createError({ statusCode: 400, message: 'No active code. Request a new one.' });
  if (row.attempts >= MAX_OTP_ATTEMPTS) {
    // Exhausted: consume the code so it can't be guessed further even within TTL.
    await db.update(schema.authTokens).set({ consumedAt: new Date() }).where(eq(schema.authTokens.id, row.id));
    throw createError({ statusCode: 429, message: 'Too many attempts. Request a new code.' });
  }

  if (!safeEqualHex(sha256(code), row.otpHash)) {
    const attempts = row.attempts + 1;
    const patch: any = { attempts };
    // On the final failed attempt, burn the code immediately.
    if (attempts >= MAX_OTP_ATTEMPTS) patch.consumedAt = new Date();
    await db.update(schema.authTokens).set(patch).where(eq(schema.authTokens.id, row.id));
    throw createError({ statusCode: 400, message: 'Incorrect code' });
  }
  await db.update(schema.authTokens).set({ consumedAt: new Date() }).where(eq(schema.authTokens.id, row.id));
  return normalized;
}

/** Upsert the user, pick their default tenant, set a session cookie. */
export async function establishSession(event: H3Event, email: string) {
  const db = useDb();
  let [user] = await db.select().from(schema.users).where(eq(schema.users.email, email)).limit(1);
  if (!user) {
    [user] = await db.insert(schema.users).values({ email }).returning();
  } else {
    await db.update(schema.users).set({ lastLogin: new Date() }).where(eq(schema.users.id, user.id));
  }

  const [membership] = await db
    .select()
    .from(schema.memberships)
    .where(eq(schema.memberships.userId, user!.id))
    .limit(1);

  await issueSession(event, {
    userId: user!.id,
    email: user!.email,
    tenantId: membership?.tenantId ?? null,
    role: membership?.role ?? null
  });

  return { user: user!, hasTenant: !!membership };
}
