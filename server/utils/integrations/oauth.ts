// server/utils/integrations/oauth.ts
// OAuth 2.0 plumbing for the CRM integrations that support it (HubSpot, Zoho,
// Pipedrive). Two jobs:
//   1. Build the provider authorize URL ("Connect with X" button) and exchange
//      the returned code for tokens.
//   2. Keep access tokens fresh — store the refresh token and exchange it
//      automatically when the access token has expired (this is what makes
//      Zoho "set and forget" instead of dying after ~1 hour).
//
// Credentials live in the integration's encrypted creds blob as:
//   { accessToken, refreshToken?, expiresAt?, dc?, apiKey?, domain? }
// where expiresAt is epoch ms. apiKey/domain remain supported for the
// paste-a-token path (HubSpot private app, Pipedrive token) which never expires.

import { useRuntimeConfig } from '#imports';

export interface OAuthCreds {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;   // epoch ms
  dc?: string;          // zoho data center
  apiKey?: string;      // non-oauth token path
  domain?: string;      // pipedrive domain
}

interface ProviderOAuth {
  authorizeUrl(state: string, redirectUri: string, dc?: string): string;
  exchangeCode(code: string, redirectUri: string, dc?: string): Promise<OAuthCreds>;
  refresh(creds: OAuthCreds): Promise<OAuthCreds>;
  supportsOAuth: boolean;
}

function cfg() {
  // Client IDs/secrets come from runtime config (env). If unset, OAuth is
  // unavailable and the UI should fall back to manual token paste.
  const c = useRuntimeConfig();
  return {
    hubspot: { id: c.hubspotClientId as string, secret: c.hubspotClientSecret as string },
    zoho: { id: c.zohoClientId as string, secret: c.zohoClientSecret as string },
    pipedrive: { id: c.pipedriveClientId as string, secret: c.pipedriveClientSecret as string }
  };
}

async function postForm(url: string, body: Record<string, string>) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString()
  });
  if (!res.ok) throw new Error(`Token endpoint ${url} returned ${res.status}`);
  return res.json() as Promise<any>;
}
const expiryFrom = (sec?: number) => Date.now() + ((sec || 3600) - 60) * 1000; // refresh 60s early

// ── HubSpot ──────────────────────────────────────────────────────────────
const hubspot: ProviderOAuth = {
  supportsOAuth: true,
  authorizeUrl(state, redirectUri) {
    const { hubspot } = cfg();
    const scopes = ['crm.objects.contacts.read', 'crm.objects.contacts.write', 'crm.objects.calls.write'].join(' ');
    const u = new URL('https://app.hubspot.com/oauth/authorize');
    u.searchParams.set('client_id', hubspot.id);
    u.searchParams.set('redirect_uri', redirectUri);
    u.searchParams.set('scope', scopes);
    u.searchParams.set('state', state);
    return u.toString();
  },
  async exchangeCode(code, redirectUri) {
    const { hubspot } = cfg();
    const d = await postForm('https://api.hubapi.com/oauth/v1/token', {
      grant_type: 'authorization_code', client_id: hubspot.id, client_secret: hubspot.secret, redirect_uri: redirectUri, code
    });
    return { accessToken: d.access_token, refreshToken: d.refresh_token, expiresAt: expiryFrom(d.expires_in) };
  },
  async refresh(creds) {
    const { hubspot } = cfg();
    const d = await postForm('https://api.hubapi.com/oauth/v1/token', {
      grant_type: 'refresh_token', client_id: hubspot.id, client_secret: hubspot.secret, refresh_token: creds.refreshToken || ''
    });
    return { ...creds, accessToken: d.access_token, refreshToken: d.refresh_token || creds.refreshToken, expiresAt: expiryFrom(d.expires_in) };
  }
};

// ── Zoho ───────────────────────────────────────────────────────────────────
// Zoho uses regional accounts.zoho.<dc> domains and returns short-lived access
// tokens with a long-lived refresh token — the key reason we add refresh here.
const zoho: ProviderOAuth = {
  supportsOAuth: true,
  authorizeUrl(state, redirectUri, dc = 'com') {
    const { zoho } = cfg();
    const scopes = ['ZohoCRM.modules.contacts.READ', 'ZohoCRM.modules.calls.CREATE', 'ZohoCRM.modules.contacts.READ'].join(',');
    const u = new URL(`https://accounts.zoho.${dc}/oauth/v2/auth`);
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('client_id', zoho.id);
    u.searchParams.set('scope', scopes);
    u.searchParams.set('redirect_uri', redirectUri);
    u.searchParams.set('access_type', 'offline');
    u.searchParams.set('prompt', 'consent');
    u.searchParams.set('state', state);
    return u.toString();
  },
  async exchangeCode(code, redirectUri, dc = 'com') {
    const { zoho } = cfg();
    const d = await postForm(`https://accounts.zoho.${dc}/oauth/v2/token`, {
      grant_type: 'authorization_code', client_id: zoho.id, client_secret: zoho.secret, redirect_uri: redirectUri, code
    });
    return { accessToken: d.access_token, refreshToken: d.refresh_token, expiresAt: expiryFrom(d.expires_in), dc };
  },
  async refresh(creds) {
    const { zoho } = cfg();
    const dc = creds.dc || 'com';
    const d = await postForm(`https://accounts.zoho.${dc}/oauth/v2/token`, {
      grant_type: 'refresh_token', client_id: zoho.id, client_secret: zoho.secret, refresh_token: creds.refreshToken || ''
    });
    // Zoho does not return a new refresh token on refresh — keep the existing one.
    return { ...creds, accessToken: d.access_token, expiresAt: expiryFrom(d.expires_in) };
  }
};

// ── Pipedrive ────────────────────────────────────────────────────────────
const pipedrive: ProviderOAuth = {
  supportsOAuth: true,
  authorizeUrl(state, redirectUri) {
    const { pipedrive } = cfg();
    const u = new URL('https://oauth.pipedrive.com/oauth/authorize');
    u.searchParams.set('client_id', pipedrive.id);
    u.searchParams.set('redirect_uri', redirectUri);
    u.searchParams.set('state', state);
    return u.toString();
  },
  async exchangeCode(code, redirectUri) {
    const { pipedrive } = cfg();
    const basic = Buffer.from(`${pipedrive.id}:${pipedrive.secret}`).toString('base64');
    const res = await fetch('https://oauth.pipedrive.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${basic}` },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri }).toString()
    });
    if (!res.ok) throw new Error(`Pipedrive token exchange ${res.status}`);
    const d: any = await res.json();
    return { accessToken: d.access_token, refreshToken: d.refresh_token, expiresAt: expiryFrom(d.expires_in), domain: d.api_domain?.replace('https://', '').split('.')[0] };
  },
  async refresh(creds) {
    const { pipedrive } = cfg();
    const basic = Buffer.from(`${pipedrive.id}:${pipedrive.secret}`).toString('base64');
    const res = await fetch('https://oauth.pipedrive.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${basic}` },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: creds.refreshToken || '' }).toString()
    });
    if (!res.ok) throw new Error(`Pipedrive refresh ${res.status}`);
    const d: any = await res.json();
    return { ...creds, accessToken: d.access_token, refreshToken: d.refresh_token || creds.refreshToken, expiresAt: expiryFrom(d.expires_in) };
  }
};

const OAUTH: Record<string, ProviderOAuth> = { hubspot, zoho, pipedrive };
export function oauthFor(provider: string): ProviderOAuth | null { return OAUTH[provider] || null; }

// Is OAuth actually configured (client id + secret present) for this provider?
export function oauthConfigured(provider: string): boolean {
  const c = cfg() as any;
  return !!(c[provider]?.id && c[provider]?.secret);
}
