// server/utils/session.ts
// JWT sessions in httpOnly secure cookies (via jose).
import { SignJWT, jwtVerify } from 'jose';
import type { H3Event } from 'h3';

const COOKIE = 'telroi_session';
const MAX_AGE = 60 * 60 * 24 * 7; // 7 days (client sessions)
const ADMIN_MAX_AGE = 60 * 60 * 8;  // 8h idle (admin) — refreshed on each request.
                                    // Thirty minutes meant being signed out over
                                    // a coffee, and an operator reading rather
                                    // than clicking still tripped it. Shorter
                                    // than a client session because this one
                                    // reaches every client's data.

export interface SessionClaims {
  userId: string;
  email: string;
  tenantId: string | null;
  role: string | null;
}

function secret(): Uint8Array {
  const s = useRuntimeConfig().jwtSecret;
  // Defense in depth: never sign/verify with the insecure default in production,
  // even if the boot preflight was somehow bypassed.
  if (process.env.NODE_ENV === 'production' && (!s || s === 'dev-insecure-secret-change-me' || s.length < 32)) {
    throw new Error('JWT_SECRET is missing or insecure in production');
  }
  return new TextEncoder().encode(s);
}

/** Record a session so it can be revoked. A signed token that is merely verified
 *  cannot be taken back: before this, signing out elsewhere, removing a member
 *  from a workspace, or somebody reporting a stolen laptop did nothing at all —
 *  a copied cookie stayed good for its full week. */
async function recordSession(event: H3Event, opts: {
  userId?: string | null; adminEmail?: string | null; tenantId?: string | null;
  kind: 'client' | 'admin'; maxAgeSec: number;
}): Promise<string | null> {
  try {
    const { useDb, schema } = await import('~/server/db');
    const [row] = await useDb().insert(schema.userSessions).values({
      userId: opts.userId || null,
      adminEmail: opts.adminEmail || null,
      tenantId: opts.tenantId || null,
      kind: opts.kind,
      ip: getRequestIP(event, { xForwardedFor: true }) || null,
      userAgent: (getHeader(event, 'user-agent') || '').slice(0, 300) || null,
      expiresAt: new Date(Date.now() + opts.maxAgeSec * 1000)
    }).returning({ id: schema.userSessions.id });
    return row?.id || null;
  } catch (e: any) {
    // A session that cannot be recorded is still a valid login — refusing to
    // sign somebody in because of a database hiccup is worse than a token we
    // cannot revoke. It is logged so the gap is visible.
    console.error('[session] could not record session:', e?.message);
    return null;
  }
}

/** Is this session still live? Null sid means a token issued before sessions
 *  were recorded, or one whose insert failed — accepted, since rejecting those
 *  would sign out everybody currently using the app. */
async function sessionLive(sid: string | undefined): Promise<boolean> {
  if (!sid) return true;
  try {
    const { useDb, schema } = await import('~/server/db');
    const { eq } = await import('drizzle-orm');
    const [row] = await useDb().select({
      revokedAt: schema.userSessions.revokedAt,
      expiresAt: schema.userSessions.expiresAt
    }).from(schema.userSessions).where(eq(schema.userSessions.id, sid)).limit(1);
    if (!row) return false;                      // deleted: treat as revoked
    if (row.revokedAt) return false;
    if (row.expiresAt && row.expiresAt < new Date()) return false;
    return true;
  } catch (e: any) {
    // Failing open on a database error: the alternative is signing out every
    // user when the database blinks, and the token's own signature and expiry
    // still stand.
    console.error('[session] revocation check failed:', e?.message);
    return true;
  }
}

/** Revoke every session for a user or an operator. The lever that did not exist:
 *  called on sign-out, when a member is removed from a workspace, and when an
 *  operator is removed from the platform. */
export async function revokeSessions(opts: { userId?: string; adminEmail?: string; reason: string }) {
  try {
    const { useDb, schema } = await import('~/server/db');
    const { eq, and, isNull } = await import('drizzle-orm');
    const who = opts.userId
      ? eq(schema.userSessions.userId, opts.userId)
      : opts.adminEmail ? eq(schema.userSessions.adminEmail, opts.adminEmail) : null;
    if (!who) return;
    await useDb().update(schema.userSessions)
      .set({ revokedAt: new Date(), revokedReason: opts.reason })
      .where(and(who, isNull(schema.userSessions.revokedAt)));
  } catch (e: any) {
    console.error('[session] revoke failed:', e?.message);
  }
}

export async function issueSession(event: H3Event, claims: SessionClaims) {
  const sid = await recordSession(event, {
    userId: claims.userId, tenantId: claims.tenantId, kind: 'client', maxAgeSec: MAX_AGE
  });

  const jwt = await new SignJWT({ ...claims, ...(sid ? { sid } : {}) })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE}s`)
    .sign(secret());

  setCookie(event, COOKIE, jwt, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: MAX_AGE
  });
}

export async function readSession(event: H3Event): Promise<SessionClaims | null> {
  const token = getCookie(event, COOKIE);
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    // The signature says the token was ours; this says it still counts.
    if (!(await sessionLive(payload.sid as string | undefined))) return null;
    return {
      userId: payload.userId as string,
      email: payload.email as string,
      tenantId: (payload.tenantId as string) ?? null,
      role: (payload.role as string) ?? null
    };
  } catch {
    return null;
  }
}

export async function clearSession(event: H3Event) {
  // Revoke before dropping the cookie. Deleting a cookie only removes this
  // browser's copy — anyone holding another kept working until the token aged
  // out, which is precisely what signing out is supposed to prevent.
  try {
    const token = getCookie(event, COOKIE);
    if (token) {
      const { payload } = await jwtVerify(token, secret());
      const sid = payload.sid as string | undefined;
      if (sid) {
        const { useDb, schema } = await import('~/server/db');
        const { eq } = await import('drizzle-orm');
        await useDb().update(schema.userSessions)
          .set({ revokedAt: new Date(), revokedReason: 'signed out' })
          .where(eq(schema.userSessions.id, sid));
      }
    }
  } catch { /* an expired or unreadable token needs no revoking */ }
  deleteCookie(event, COOKIE, { path: '/' });
}

// ── Platform-admin session — a SEPARATE cookie so an operator can be logged
// into the admin console and a client workspace at the same time without one
// clobbering the other. ──
const ADMIN_COOKIE = 'telroi_admin_session';

export interface AdminSessionClaims { email: string; role: string; }

export async function issueAdminSession(event: H3Event, claims: AdminSessionClaims, existingSid?: string) {
  // refreshAdminSession runs on every authenticated request to hold the idle
  // window open, so it must reuse the session it already has — minting one per
  // request would write a row per click and leave thousands to revoke.
  const sid = existingSid || await recordSession(event, {
    adminEmail: claims.email, kind: 'admin', maxAgeSec: ADMIN_MAX_AGE
  });

  const jwt = await new SignJWT({ ...claims, kind: 'admin', ...(sid ? { sid } : {}) })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${ADMIN_MAX_AGE}s`)
    .sign(secret());
  setCookie(event, ADMIN_COOKIE, jwt, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: ADMIN_MAX_AGE
  });
}

// Re-issue the admin cookie to reset the 30-min idle window. Called on each
// authenticated admin request so active operators stay logged in; 30 min of
// no requests lets the cookie expire (idle logout).
export async function refreshAdminSession(event: H3Event, claims: AdminSessionClaims) {
  // Carry the existing session id across, or the refresh would create a new row
  // on every request and orphan the one being refreshed.
  let sid: string | undefined;
  try {
    const token = getCookie(event, ADMIN_COOKIE);
    if (token) { const { payload } = await jwtVerify(token, secret()); sid = payload.sid as string | undefined; }
  } catch { /* re-issued without one */ }
  await issueAdminSession(event, claims, sid);
}

export async function readAdminSession(event: H3Event): Promise<AdminSessionClaims | null> {
  const token = getCookie(event, ADMIN_COOKIE);
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    if (payload.kind !== 'admin') return null;
    if (!(await sessionLive(payload.sid as string | undefined))) return null;
    return { email: payload.email as string, role: payload.role as string };
  } catch {
    return null;
  }
}

export async function clearAdminSession(event: H3Event) {
  try {
    const token = getCookie(event, ADMIN_COOKIE);
    if (token) {
      const { payload } = await jwtVerify(token, secret());
      const sid = payload.sid as string | undefined;
      if (sid) {
        const { useDb, schema } = await import('~/server/db');
        const { eq } = await import('drizzle-orm');
        await useDb().update(schema.userSessions)
          .set({ revokedAt: new Date(), revokedReason: 'signed out' })
          .where(eq(schema.userSessions.id, sid));
      }
    }
  } catch { /* as above */ }
  deleteCookie(event, ADMIN_COOKIE, { path: '/' });
}
