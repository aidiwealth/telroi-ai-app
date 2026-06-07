// server/utils/api.ts
// Shared helpers: consistent error envelope, auth/tenant guards, rate limiting.
import type { H3Event } from 'h3';
import { readSession, type SessionClaims } from './session';

export function apiError(code: string, message: string, status = 400) {
  return createError({ statusCode: status, data: { error: { code, message } }, message });
}

/** Require a logged-in user. Throws 401 otherwise. */
export async function requireUser(event: H3Event): Promise<SessionClaims> {
  const s = await readSession(event);
  if (!s) throw apiError('unauthorized', 'Authentication required', 401);
  return s;
}

/** Require a user WITH an active tenant. Throws 401/403 otherwise. */
export async function requireTenant(event: H3Event): Promise<SessionClaims & { tenantId: string }> {
  const s = await requireUser(event);
  if (!s.tenantId) throw apiError('no_tenant', 'No active workspace', 403);
  return s as SessionClaims & { tenantId: string };
}

/** Require the active tenant membership to be owner/admin (management actions). */
export async function requireTenantManager(event: H3Event): Promise<SessionClaims & { tenantId: string; role: string }> {
  const s = await requireTenant(event);
  const { useDb, schema } = await import('../db');
  const { and, eq } = await import('drizzle-orm');
  const db = useDb();
  const [m] = await db.select().from(schema.memberships)
    .where(and(eq(schema.memberships.tenantId, s.tenantId), eq(schema.memberships.userId, s.userId))).limit(1);
  if (!m || (m.role !== 'owner' && m.role !== 'admin')) {
    throw apiError('forbidden', 'Only workspace owners or admins can do this.', 403);
  }
  return { ...s, role: m.role } as any;
}

/* ---------- naive in-memory rate limiter (per-process) ----------
   DECISION: in-memory is fine for a single DO node / dev. For multi-node,
   swap the Map for Redis. Keyed by `${bucket}:${id}`. */
const hits = new Map<string, { count: number; reset: number }>();

export function rateLimit(bucket: string, id: string, max: number, windowMs: number) {
  const key = `${bucket}:${id}`;
  const now = Date.now();
  const cur = hits.get(key);
  if (!cur || now > cur.reset) {
    hits.set(key, { count: 1, reset: now + windowMs });
    return;
  }
  cur.count += 1;
  if (cur.count > max) {
    const retry = Math.ceil((cur.reset - now) / 1000);
    throw apiError('rate_limited', `Too many requests. Try again in ${retry}s.`, 429);
  }
}

export function clientIp(event: H3Event): string {
  const xff = getRequestHeader(event, 'x-forwarded-for');
  if (xff) return xff.split(',')[0]!.trim();
  return event.node.req.socket?.remoteAddress || 'unknown';
}
