// server/utils/voice-token.ts
// Mints real browser-voice access tokens / SIP credentials per provider so the
// front-end WebRTC SDK can register and place calls (mic + ringing + audio).
import { SignJWT } from 'jose';
import { DEFAULT_SIP_DOMAIN } from '~/server/utils/sip-config';
import { voiceCredentials } from './voice-credentials';

// ── Twilio Voice access token ──
// Twilio access tokens are HS256 JWTs signed with the API Key SECRET, with a
// specific header (cty + the API key sid as `iss`/sub claims) and a `grants`
// claim containing a voice grant referencing the TwiML App SID.
export async function twilioVoiceToken(identity: string, preferredCallerId?: string | null) {
  const { twilio } = await voiceCredentials();
  if (!twilio) throw new Error('Twilio Voice not configured');
  const now = Math.floor(Date.now() / 1000);
  const secret = new TextEncoder().encode(twilio.apiKeySecret);
  const jwt = await new SignJWT({
    grants: {
      identity,
      voice: { outgoing: { application_sid: twilio.twimlAppSid }, incoming: { allow: true } }
    }
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT', cty: 'twilio-fpa;v=1' })
    .setIssuer(twilio.apiKeySid)
    .setSubject(twilio.accountSid)
    .setIssuedAt(now)
    .setNotBefore(now)
    .setExpirationTime(now + 3600)
    .setJti(`${twilio.apiKeySid}-${now}`)
    .sign(secret);
  // The number the caller chose to dial from, as Telnyx has always done — a
  // platform-wide caller id would put our number on every client's outbound
  // calls, and the person answering could not tell who was ringing them. The
  // caller was passed in and dropped here, so the TwiML came back with an empty
  // callerId and Twilio refused every call.
  return { provider: 'twilio', token: jwt, identity, callerId: preferredCallerId || twilio.callerId, expiresIn: 3600 };
}

// ── Telnyx WebRTC: on-demand JWT via Telnyx API using the SIP connection ──
// Telnyx issues a telephony credential token from a programmable credential.
// We create/refresh a token from the connection's credential via their API.
export async function telnyxVoiceToken(preferredCallerId?: string | null) {
  const { telnyx } = await voiceCredentials();
  if (!telnyx) throw new Error('Telnyx Voice not configured');
  // Telnyx WebRTC clients can log in directly with the SIP credential
  // (username/password) OR a short-lived JWT. We return the credential login the
  // @telnyx/webrtc SDK accepts, plus connection metadata.
  // Caller ID: whoever is placing the call decides. The client dialer passes the
  // number the user picked, and that wins — they chose it. Admin support passes
  // nothing, so it falls back to the dedicated support number (Settings ->
  // support number by region) rather than pinning itself to whatever sits on the
  // WebRTC card.
  let callerId = preferredCallerId || telnyx.callerId || '';
  if (!preferredCallerId) {
    try {
      const { supportNumberForCountry } = await import('./support-numbers');
      const support = await supportNumberForCountry('INTL');
      if (support) callerId = support;
    } catch { /* fall back to card callerId */ }
  }
  return {
    provider: 'telnyx',
    login: telnyx.sipUsername,
    password: telnyx.sipPassword,
    connectionId: telnyx.connectionId,
    callerId
  };
}



export async function asteriskVoiceToken(identity: string, client: 'browser' | 'native' = 'browser') {
  const { useDb, schema } = await import('~/server/db');
  const { and, eq } = await import('drizzle-orm');
  const { decrypt } = await import('~/server/utils/crypto');
  // identity = tenant_<tenantId>_<userId>
  const mm = /^tenant_([0-9a-f-]+)_([0-9a-f-]+)$/.exec(identity);
  const tenantId = mm ? mm[1] : identity;
  const userId = mm ? mm[2] : null;
  const db = useDb();
  const rows = await db.select().from(schema.sipEndpoints)
    .where(and(eq(schema.sipEndpoints.tenantId, tenantId), eq(schema.sipEndpoints.provider, 'telroi')));
  // Their own endpoint of the right kind. meta.kind where it exists, meta.webrtc
  // for rows written before native clients did.
  const isKind = (r: any) => {
    const m = (r.meta as any) || {};
    return (m.kind || (m.webrtc ? 'browser' : null)) === client;
  };
  let ep = userId
    ? rows.find((r: any) => r.secretEnc && isKind(r) && (r.meta as any)?.userId === userId)
    : undefined;
  // The fallback is for old data and is browser-only: handing a native client
  // somebody's WebRTC endpoint is what the 488 was.
  if (!ep && client === 'browser') {
    ep = rows.find((r: any) => r.secretEnc && (((r.meta as any)?.webrtc) || r.label === 'browser-dialer'));
  }
  if (!ep) {
    throw Object.assign(new Error('Browser calling is not set up yet for this workspace.'), {
      statusCode: 409, data: { error: { code: 'webrtc_not_provisioned' } }
    });
  }
  const sipDomain = process.env.SIP_DOMAIN || DEFAULT_SIP_DOMAIN;
  const wsServer = (useRuntimeConfig().public as any)?.sipWsServer || `wss://${sipDomain}:8089/ws`;
  return {
    provider: 'telroi',
    sipUsername: ep.sipUsername,
    sipPassword: decrypt(ep.secretEnc!),
    sipDomain,
    // The browser path, unchanged.
    wsServer,
    // The native path. A mobile client cannot speak SIP over WebSocket, so it
    // registers to the same endpoint over TLS on 5061. Sent rather than
    // assumed, so the port can move without shipping a new app build.
    transport: 'tls',
    sipPort: Number(process.env.SIP_TLS_PORT || 5061),
    // What this endpoint actually offers. A browser endpoint is webrtc=yes and
    // negotiates DTLS-SRTP; a native one offers plain RTP. Saying dtls to a
    // native client was the 488 — it refused an offer it could not take,
    // whatever codecs it had enabled.
    mediaEncryption: client === 'native' ? 'none' : 'dtls'
  };
}


export async function voiceTokenFor(provider: string, identity: string, preferredCallerId?: string | null, client: 'browser' | 'native' = 'browser') {
  if (provider === 'twilio') return await twilioVoiceToken(identity, preferredCallerId);
  if (provider === 'telnyx') return await telnyxVoiceToken(preferredCallerId);
  // client threads through: the lookup and the media profile live in
  // asteriskVoiceToken, not here, and a parameter added to the wrapper alone
  // left `client` undefined where it is actually used — which took the browser
  // dialler down with it.
  if (provider === 'telroi' || provider === 'asterisk') return await asteriskVoiceToken(identity, client);
  throw new Error(`Unknown voice provider: ${provider}`);
}
