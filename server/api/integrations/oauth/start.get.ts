// GET /api/integrations/oauth/start?provider=hubspot[&dc=com]
// Builds the provider OAuth authorize URL and returns it (the client redirects
// the browser there). State is a short-lived signed JWT carrying tenant+provider
// so the callback can trust it. Falls back with 400 if OAuth isn't configured.
import { SignJWT } from 'jose';
import { requireTenantManager, apiError } from '~/server/utils/api';
import { oauthFor, oauthConfigured } from '~/server/utils/integrations/oauth';
export default defineEventHandler(async (event) => {
  const s = await requireTenantManager(event);
  const q = getQuery(event);
  const provider = String(q.provider || '');
  const dc = q.dc ? String(q.dc) : 'com';
  const oauth = oauthFor(provider);
  if (!oauth || !oauth.supportsOAuth) throw apiError('unsupported', 'This provider does not support one-click connect', 400);
  if (!oauthConfigured(provider)) throw apiError('not_configured', 'OAuth is not configured for this provider — paste a token instead', 400);

  const cfg = useRuntimeConfig();
  const base = (cfg.appBaseUrl as string) || getRequestURL(event).origin;
  const redirectUri = `${base}/api/integrations/oauth/callback`;
  const secret = new TextEncoder().encode(cfg.jwtSecret as string);
  const state = await new SignJWT({ t: s.tenantId, p: provider, dc })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('10m').sign(secret);

  return { url: oauth.authorizeUrl(state, redirectUri, dc) };
});
