// server/utils/webhook-verify.ts
// Carrier webhook signature verification. Each returns true (valid),
// false (invalid -> reject), or null/undefined (not configured -> caller decides).
import crypto from 'node:crypto';
import { platformSettings, masterCarrierCreds } from './platform';
import { decrypt } from './crypto';

// Twilio signs requests with the auth token over the full URL + sorted params.
export async function verifyTwilioSignature(event: any, params: Record<string, string>): Promise<boolean | null> {
  const sig = getHeader(event, 'x-twilio-signature');
  if (!sig) return null;
  const master = await masterCarrierCreds();
  const token = master?.twilio?.authToken;
  if (!token) return null;
  const proto = getHeader(event, 'x-forwarded-proto') || 'https';
  const host = getHeader(event, 'host');
  const url = `${proto}://${host}${event.path}`;
  const sorted = Object.keys(params).filter((k) => k !== 'bodySHA256').sort();
  let data = url;
  for (const k of sorted) data += k + (params[k] ?? '');
  const expected = crypto.createHmac('sha1', token).update(Buffer.from(data, 'utf-8')).digest('base64');
  try { return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig)); } catch { return false; }
}

// Telnyx signs with Ed25519 over `${timestamp}|${rawBody}` using their public key.
export async function verifyTelnyxSignature(event: any, rawBody?: string): Promise<boolean | null> {
  const sig = getHeader(event, 'telnyx-signature-ed25519');
  const ts = getHeader(event, 'telnyx-timestamp');
  if (!sig || !ts) return null;
  const s = await platformSettings();
  const pubEnc = (s as any)?.telnyxWebhookSecretEnc;
  if (!pubEnc) return null;
  let pubKey: string;
  try { pubKey = decrypt(pubEnc); } catch { return null; }
  if (!rawBody) return null;
  try {
    const signed = `${ts}|${rawBody}`;
    const key = crypto.createPublicKey({ key: Buffer.from(pubKey, 'base64'), format: 'der', type: 'spki' });
    return crypto.verify(null, Buffer.from(signed), key, Buffer.from(sig, 'base64'));
  } catch { return false; }
}

// PBX inbound: simple shared-secret header compare.
export async function verifyPbxSecret(event: any): Promise<boolean | null> {
  const given = getHeader(event, 'x-telroi-pbx-secret');
  if (!given) return null;
  const s = await platformSettings();
  const enc = (s as any)?.pbxWebhookSecretEnc;
  if (!enc) return null;
  let secret: string;
  try { secret = decrypt(enc); } catch { return null; }
  try { return crypto.timingSafeEqual(Buffer.from(given), Buffer.from(secret)); } catch { return false; }
}


export async function verifyAsteriskSecret(event: any): Promise<boolean | null> {
  const given = getHeader(event, 'x-telroi-asterisk-secret');
  if (!given) return null;
  const s = await platformSettings();
  const enc = (s as any)?.asteriskWebhookSecretEnc;
  if (!enc) return null;
  let secret: string;
  try { secret = decrypt(enc); } catch { return null; }
  try { return crypto.timingSafeEqual(Buffer.from(given), Buffer.from(secret)); } catch { return false; }
}

export async function verifySotelSecret(event: any): Promise<boolean | null> {
  const given = getHeader(event, 'x-telroi-sotel-secret');
  if (!given) return null;
  const s = await platformSettings();
  const enc = (s as any)?.sotelWebhookSecretEnc;
  if (!enc) return null;
  let secret: string;
  try { secret = decrypt(enc); } catch { return null; }
  try { return crypto.timingSafeEqual(Buffer.from(given), Buffer.from(secret)); } catch { return false; }
}

export async function verifyRuachSecret(event: any): Promise<boolean | null> {
  const given = getHeader(event, 'x-telroi-ruach-secret');
  if (!given) return null;
  const s = await platformSettings();
  const enc = (s as any)?.ruachWebhookSecretEnc;
  if (!enc) return null;
  let secret: string;
  try { secret = decrypt(enc); } catch { return null; }
  try { return crypto.timingSafeEqual(Buffer.from(given), Buffer.from(secret)); } catch { return false; }
}
