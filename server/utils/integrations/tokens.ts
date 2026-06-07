// server/utils/integrations/tokens.ts
// Resolves usable credentials for an integration, transparently refreshing an
// expired OAuth access token and persisting the new token back to the row.
// Adapters keep using creds.accessToken / creds.apiKey as before — they don't
// need to know whether a refresh happened.
import { eq } from 'drizzle-orm';
import { useDb, schema } from '../../db';
import { decrypt, encrypt } from '../crypto';
import { oauthFor, type OAuthCreds } from './oauth';

// Given an integration row id + its decrypted creds, return creds with a valid
// access token. If the token is OAuth-based and expired (and we have a refresh
// token), refresh, persist, and return the updated creds.
export async function ensureValidCreds(integrationId: string, provider: string, creds: OAuthCreds): Promise<OAuthCreds> {
  // Non-OAuth path (HubSpot private-app token / Pipedrive API token): nothing to refresh.
  if (creds.apiKey && !creds.refreshToken) return creds;
  // No expiry tracked, or not yet expired → use as-is.
  if (!creds.expiresAt || creds.expiresAt > Date.now()) return creds;
  // Expired and we can refresh.
  const oauth = oauthFor(provider);
  if (!oauth || !creds.refreshToken) return creds; // can't refresh; let the call fail with a clear 401
  try {
    const fresh = await oauth.refresh(creds);
    const db = useDb();
    await db.update(schema.integrations)
      .set({ credentialsEnc: encrypt(JSON.stringify(fresh)), lastSyncError: null })
      .where(eq(schema.integrations.id, integrationId));
    return fresh;
  } catch (e: any) {
    const db = useDb();
    await db.update(schema.integrations)
      .set({ status: 'error', lastSyncError: `Token refresh failed: ${String(e?.message || e).slice(0, 200)}` })
      .where(eq(schema.integrations.id, integrationId));
    throw new Error('Could not refresh the access token — the connection may need to be reconnected.');
  }
}

// Convenience: load + decrypt + ensure-valid in one call, given a tenant+provider.
export async function loadValidCreds(tenantId: string, provider: string): Promise<{ id: string; creds: OAuthCreds } | null> {
  const db = useDb();
  const rows = await db.select().from(schema.integrations).where(eq(schema.integrations.tenantId, tenantId));
  const row = rows.find((r) => r.provider === provider && r.status !== 'disconnected');
  if (!row || !row.credentialsEnc) return null;
  let creds: OAuthCreds;
  try { creds = JSON.parse(decrypt(row.credentialsEnc)); } catch { return null; }
  const valid = await ensureValidCreds(row.id, provider, creds);
  return { id: row.id, creds: valid };
}
