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
export const telnyxHangup = (callId: string) => cmd(callId, 'hangup', {});

// Speak text, then Telnyx fires call.speak.ended (carrying client_state so we advance).
export const telnyxSpeak = (callId: string, text: string, nextNodeId: string | null) =>
  cmd(callId, 'speak', { payload: text, voice: 'female', language: 'en-US', client_state: encodeState(nextNodeId) });

// Speak a menu prompt and gather one digit; Telnyx fires call.gather.ended.
export const telnyxGather = (callId: string, prompt: string, menuNodeId: string) =>
  cmd(callId, 'gather_using_speak', {
    payload: prompt, voice: 'female', language: 'en-US',
    minimum_digits: 1, maximum_digits: 1, timeout_millis: 6000,
    client_state: encodeState(menuNodeId)
  });

// Transfer to a SIP/PSTN destination (person/department escalation target).
export const telnyxTransfer = (callId: string, to: string) =>
  cmd(callId, 'transfer', { to });
