// GET /api/integrations/oauth/callback?code=...&state=...
// The provider redirects the browser here after consent. We validate state,
// exchange the code for tokens, and upsert the integration. Then bounce the
// user back to /apps with a status flag.
import { jwtVerify } from 'jose';
import { and, eq } from 'drizzle-orm';
import { useDb, schema } from '~/server/db';
import { encrypt } from '~/server/utils/crypto';
import { oauthFor } from '~/server/utils/integrations/oauth';

export default defineEventHandler(async (event) => {
  const q = getQuery(event);
  const code = String(q.code || ''); const stateRaw = String(q.state || '');
  const back = (ok: boolean, provider = '') => sendRedirect(event, `/apps?tab=integrations&connected=${ok ? provider : 'error'}`, 302);
  if (!code || !stateRaw) return back(false);

  const cfg = useRuntimeConfig();
  let claims: any;
  try {
    const secret = new TextEncoder().encode(cfg.jwtSecret as string);
    claims = (await jwtVerify(stateRaw, secret)).payload;
  } catch { return back(false); }

  const provider = claims.p as string; const tenantId = claims.t as string; const dc = claims.dc as string;
  const oauth = oauthFor(provider);
  if (!oauth) return back(false);

  const base = (cfg.appBaseUrl as string) || getRequestURL(event).origin;
  const redirectUri = `${base}/api/integrations/oauth/callback`;
  try {
    const creds = await oauth.exchangeCode(code, redirectUri, dc);
    const db = useDb();
    const credentialsEnc = encrypt(JSON.stringify(creds));
    const [existing] = await db.select().from(schema.integrations)
      .where(and(eq(schema.integrations.tenantId, tenantId), eq(schema.integrations.provider, provider))).limit(1);
    if (existing) {
      await db.update(schema.integrations).set({ status: 'connected', credentialsEnc, lastSyncError: null, connectedAt: new Date() }).where(eq(schema.integrations.id, existing.id));
    } else {
      await db.insert(schema.integrations).values({ tenantId, provider, status: 'connected', credentialsEnc, modeEmbed: true, modeImport: false });
    }
    return back(true, provider);
  } catch (e) { console.error('[oauth callback] exchange failed', e); return back(false); }
});
