// server/utils/telnyx-cc.ts
// Telnyx Call Control command issuer. Telnyx is fully async: on each webhook
// event we POST a command back to the call, tracking flow position in
// client_state (base64) which Telnyx echoes on every subsequent event.
import { platformSettings } from '~/server/utils/platform';
import { decrypt } from '~/server/utils/crypto';

// Load the platform Telnyx API key from platform settings.
async function telnyxApiKey(): Promise<string | null> {
  try {
    const s = await platformSettings();
    if (!s?.telnyxCredsEnc) return null;
    const creds = JSON.parse(decrypt(s.telnyxCredsEnc)) as { apiKey?: string };
    return creds?.apiKey || null;
  } catch { return null; }
}

async function cmd(callId: string, action: string, body: Record<string, any>): Promise<boolean> {
  const key = await telnyxApiKey();
  if (!key) { console.error('[telnyx-cc] no API key'); return false; }
  try {
    const r = await fetch(`https://api.telnyx.com/v2/calls/${encodeURIComponent(callId)}/actions/${action}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!r.ok) { console.error(`[telnyx-cc] ${action} ${r.status}`); return false; }
    return true;
  } catch (e) { console.error(`[telnyx-cc] ${action} error`, e); return false; }
}

export function encodeState(nodeId: string | null | undefined): string {
  return Buffer.from(JSON.stringify({ n: nodeId || null })).toString('base64');
}
export function decodeState(cs: string | null | undefined): { n: string | null } {
  try { return JSON.parse(Buffer.from(cs || '', 'base64').toString('utf8')); } catch { return { n: null }; }
}

export const telnyxAnswer = (callId: string) => cmd(callId, 'answer', {});

// Start bidirectional media streaming to our control-app WebSocket. Telnyx forks
// the call's audio to stream_url and accepts audio back on the same socket. PCMU
// (mu-law 8kHz, Telnyx default) both directions for the AI media adapter.
export const telnyxStreamingStart = (
  callId: string,
  streamUrl: string,
  meta?: { agentId?: string; tenantId?: string; telnum?: string; escalateTo?: string | null; escalateAfter?: number }
) =>
  cmd(callId, 'streaming_start', {
    stream_url: streamUrl,
    stream_track: 'inbound_track',
    stream_bidirectional_mode: 'rtp',
    stream_bidirectional_codec: 'PCMU',
    // Telnyx echoes client_state back in the WS `start` event, which is how the
    // media adapter learns which agent/tenant this call belongs to (the socket
    // itself only carries the call_control_id).
    ...(meta ? { client_state: Buffer.from(JSON.stringify(meta)).toString('base64') } : {})
  });
export const telnyxHangup = (callId: string) => cmd(callId, 'hangup', {});

// Speak text, then Telnyx fires call.speak.ended (carrying client_state so we advance).
export const telnyxSpeak = (callId: string, text: string, nextNodeId: string | null) =>
  cmd(callId, 'speak', { payload: text, voice: 'female', language: 'en-US', client_state: encodeState(nextNodeId) });

// Read a one-time code aloud. Its own command rather than telnyxSpeak because a
// code needs saying digit by digit with pauses — handed over as a plain string,
// "472913" is read as four hundred seventy-two thousand and the caller learns
// nothing. SSML gives the pacing and the repetition the OTP contract asks for.
export const telnyxSpeakCode = (callId: string, code: string, repeats: number = 2) => {
  // Same script the Nigerian path plays, so a caller hears the same thing
  // whichever carrier reached them. The second reading is signposted rather than
  // simply repeated: somebody writing a code down needs to know another go is
  // coming, not wonder whether the recording has looped.
  const digits = code.split('').join('<break time="350ms"/>');
  const parts = Array.from({ length: Math.max(1, Math.min(repeats, 5)) }).map((_, i) =>
    i === 0
      ? `Hi. Your O T P code is<break time="400ms"/>${digits}`
      : `Let me repeat that.<break time="300ms"/>Your O T P code is<break time="400ms"/>${digits}`
  );
  parts.push('Please do not share this code with anyone.<break time="300ms"/>Goodbye.');
  const body = parts.join('<break time="900ms"/>');
  return cmd(callId, 'speak', {
    payload: `<speak>${body}</speak>`,
    payload_type: 'ssml',
    voice: 'female',
    language: 'en-US',
    client_state: encodeState('otp-done')
  });
};

// Speak a menu prompt and gather one digit; Telnyx fires call.gather.ended.
export const telnyxGather = (callId: string, prompt: string, menuNodeId: string) =>
  cmd(callId, 'gather_using_speak', {
    payload: prompt, voice: 'female', language: 'en-US',
    minimum_digits: 1, maximum_digits: 1, timeout_millis: 6000,
    client_state: encodeState(menuNodeId)
  });

// Transfer to a SIP/PSTN destination (person/department escalation target).
export const telnyxTransfer = (callId: string, to: string, headers?: Record<string, string>) =>
  cmd(callId, 'transfer', {
    to,
    // Telnyx puts these on the SIP INVITE, which is how a department name
    // survives the hop back to our PBX. The user part is already carrying the
    // DID and the call id, and a third field there would be one delimiter too
    // many.
    ...(headers && Object.keys(headers).length
      ? { custom_headers: Object.entries(headers).map(([name, value]) => ({ name, value })) }
      : {})
  });
