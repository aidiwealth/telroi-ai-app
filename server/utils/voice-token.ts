// server/utils/voice-token.ts
// Mints real browser-voice access tokens / SIP credentials per provider so the
// front-end WebRTC SDK can register and place calls (mic + ringing + audio).
import { SignJWT } from 'jose';
import { voiceCredentials } from './voice-credentials';

// ── Twilio Voice access token ──
// Twilio access tokens are HS256 JWTs signed with the API Key SECRET, with a
// specific header (cty + the API key sid as `iss`/sub claims) and a `grants`
// claim containing a voice grant referencing the TwiML App SID.
export async function twilioVoiceToken(identity: string) {
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
  return { provider: 'twilio', token: jwt, identity, callerId: twilio.callerId, expiresIn: 3600 };
}

// ── Telnyx WebRTC: on-demand JWT via Telnyx API using the SIP connection ──
// Telnyx issues a telephony credential token from a programmable credential.
// We create/refresh a token from the connection's credential via their API.
export async function telnyxVoiceToken() {
  const { telnyx } = await voiceCredentials();
  if (!telnyx) throw new Error('Telnyx Voice not configured');
  // Telnyx WebRTC clients can log in directly with the SIP credential
  // (username/password) OR a short-lived JWT. We return the credential login the
  // @telnyx/webrtc SDK accepts, plus connection metadata.
  return {
    provider: 'telnyx',
    login: telnyx.sipUsername,
    password: telnyx.sipPassword,
    connectionId: telnyx.connectionId,
    callerId: telnyx.callerId
  };
}

// ── Digidite WebRTC/SIP: the browser SIP.js client registers against the
// gateway with these credentials. ──
export async function digiditeVoiceToken() {
  const { digidite } = await voiceCredentials();
  if (!digidite) throw new Error('Digidite Voice not configured');
  return {
    provider: 'digidite',
    wsServer: digidite.wsServer,
    sipDomain: digidite.sipDomain,
    sipUsername: digidite.sipUsername,
    sipPassword: digidite.sipPassword,
    callerId: digidite.callerId
  };
}

export async function sotelVoiceToken() {
  const { sotel } = await voiceCredentials();
  if (!sotel || !sotel.sipGateway) throw new Error('Sotel SIP trunk not configured');
  // Sotel is a direct SIP trunk: hand the gateway/transport/caller-id to the
  // media layer, which registers/peers with Sotel and bridges the audio. For
  // IP-authenticated trunks authUser/authPass are blank.
  return {
    provider: 'sotel',
    sipGateway: sotel.sipGateway,
    sipPort: sotel.sipPort || 5060,
    transport: sotel.transport || 'udp',
    sipDomain: sotel.sipDomain || sotel.sipGateway,
    authUser: sotel.authUser || '',
    authPass: sotel.authPass || '',
    callerId: sotel.callerId || (sotel.dids && sotel.dids[0]) || '',
    dids: sotel.dids || []
  };
}

export async function asteriskVoiceToken() {
  const { asterisk } = await voiceCredentials();
  if (!asterisk || !asterisk.sipGateway) throw new Error('Asterisk SIP trunk not configured');
  return {
    provider: 'asterisk',
    sipGateway: asterisk.sipGateway,
    sipPort: asterisk.sipPort || 5060,
    transport: asterisk.transport || 'udp',
    sipDomain: asterisk.sipDomain || asterisk.sipGateway,
    authUser: asterisk.authUser || '',
    authPass: asterisk.authPass || '',
    callerId: asterisk.callerId || (asterisk.dids && asterisk.dids[0]) || '',
    dids: asterisk.dids || [],
    apiBaseUrl: asterisk.apiBaseUrl || '', ariAppName: asterisk.ariAppName || ''
  };
}

export async function ruachVoiceToken() {
  const { ruach } = await voiceCredentials();
  if (!ruach || !ruach.sipAccount) throw new Error('Ruach SIP trunk not configured');
  return {
    provider: 'ruach',
    sipAccount: ruach.sipAccount,
    sipDomain: ruach.sipDomain || 'sip.ruach.ng',
    callerId: ruach.callerId || (ruach.dids && ruach.dids[0]) || '',
    dids: ruach.dids || []
  };
}

export async function voiceTokenFor(provider: string, identity: string) {
  if (provider === 'twilio') return await twilioVoiceToken(identity);
  if (provider === 'telnyx') return await telnyxVoiceToken();
  if (provider === 'digidite') return await digiditeVoiceToken();
  if (provider === 'sotel') return await sotelVoiceToken();
  if (provider === 'asterisk') return await asteriskVoiceToken();
  if (provider === 'ruach') return await ruachVoiceToken();
  throw new Error(`Unknown voice provider: ${provider}`);
}
