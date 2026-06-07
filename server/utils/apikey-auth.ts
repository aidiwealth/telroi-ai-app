// server/utils/apikey-auth.ts
// Authenticates public API (/v1) requests via a customer API key.
// Key format: tlr_live_<32 random chars>. Only the SHA-256 hash is stored.
// Header: Authorization: Bearer tlr_live_...   (or X-API-Key: tlr_live_...)
import type { H3Event } from 'h3';
import { and, eq, isNull } from 'drizzle-orm';
import { useDb, schema } from '../db';
import { sha256 } from './crypto';
import { apiError } from './api';

export interface ApiKeyContext {
  tenantId: string;
  keyId: string;
  scopes: string[];
  env: 'live' | 'sandbox';   // derived from the key prefix (tlr_live / tlr_test)
}

export async function requireApiKey(event: H3Event): Promise<ApiKeyContext> {
  const auth = getRequestHeader(event, 'authorization');
  const headerKey = getRequestHeader(event, 'x-api-key');
  const raw = auth?.startsWith('Bearer ') ? auth.slice(7).trim() : headerKey?.trim();

  if (!raw || !raw.startsWith('tlr_')) {
    throw apiError('unauthorized', 'Missing or malformed API key', 401);
  }

  let key;
  try {
    const db = useDb();
    [key] = await db.select().from(schema.apiKeys)
      .where(and(eq(schema.apiKeys.keyHash, sha256(raw)), isNull(schema.apiKeys.revokedAt)))
      .limit(1);
  } catch {
    // Fail closed: never leak a 500 from the auth path.
    throw apiError('service_unavailable', 'Key verification temporarily unavailable', 503);
  }
  if (!key) throw apiError('unauthorized', 'Invalid or revoked API key', 401);

  // Best-effort last-used stamp (don't block the request on it).
  try { useDb().update(schema.apiKeys).set({ lastUsedAt: new Date() }).where(eq(schema.apiKeys.id, key.id)).catch(() => {}); } catch { /* ignore */ }

  // Environment is determined by the key itself: tlr_test_ = sandbox, tlr_live_ = live.
  const env: 'live' | 'sandbox' = key.prefix === 'tlr_test' || raw.startsWith('tlr_test') ? 'sandbox' : 'live';

  const ctx: ApiKeyContext = { tenantId: key.tenantId, keyId: key.id, scopes: (key.scopes as string[]) || ['*'], env };

  // Per-key request rate limit — protects the platform (and the customer's own
  // wallet) from runaway loops or a leaked key hammering costly endpoints.
  // 600 requests / minute per key is generous for normal use but caps abuse.
  // Throws 429 when exceeded. Keyed by the key id so one customer can't exhaust
  // capacity for others.
  const { rateLimit } = await import('./api');
  rateLimit('api_key', ctx.keyId, 600, 60 * 1000);

  return ctx;
}

export function hasScope(ctx: ApiKeyContext, scope: string): boolean {
  return ctx.scopes.includes('*') || ctx.scopes.includes(scope);
}
