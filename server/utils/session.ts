// server/utils/session.ts
// JWT sessions in httpOnly secure cookies (via jose).
import { SignJWT, jwtVerify } from 'jose';
import type { H3Event } from 'h3';

const COOKIE = 'telroi_session';
const MAX_AGE = 60 * 60 * 24 * 7; // 7 days (client sessions)
const ADMIN_MAX_AGE = 60 * 30;      // 30 min idle (admin) — refreshed on each request

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

export async function issueSession(event: H3Event, claims: SessionClaims) {
  const jwt = await new SignJWT({ ...claims })
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

export function clearSession(event: H3Event) {
  deleteCookie(event, COOKIE, { path: '/' });
}

// ── Platform-admin session — a SEPARATE cookie so an operator can be logged
// into the admin console and a client workspace at the same time without one
// clobbering the other. ──
const ADMIN_COOKIE = 'telroi_admin_session';

export interface AdminSessionClaims { email: string; role: string; }

export async function issueAdminSession(event: H3Event, claims: AdminSessionClaims) {
  const jwt = await new SignJWT({ ...claims, kind: 'admin' })
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
  await issueAdminSession(event, claims);
}

export async function readAdminSession(event: H3Event): Promise<AdminSessionClaims | null> {
  const token = getCookie(event, ADMIN_COOKIE);
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    if (payload.kind !== 'admin') return null;
    return { email: payload.email as string, role: payload.role as string };
  } catch {
    return null;
  }
}

export function clearAdminSession(event: H3Event) {
  deleteCookie(event, ADMIN_COOKIE, { path: '/' });
}
