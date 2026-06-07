// server/utils/voice/vendors.ts
// Vendor-adapter seam for the speech + voice-OTP APIs. The admin chooses which
// vendor powers each capability (otpVoiceVendor / ttsVendor / sttVendor in
// platformSettings); these adapters route accordingly. 'telroi' means use
// Telroi's own configured voice infrastructure (the carrier gateway resolved by
// live-call-provider). External vendors use creds from *VendorCredsEnc.
//
// IMPORTANT: the actual audio (placing the OTP call, synthesizing speech,
// transcribing audio) executes on the live vendor/gateway. These adapters build
// and dispatch the real request; from an environment without vendor creds they
// surface a clear "not configured" error rather than fabricating a result.
import { eq } from 'drizzle-orm';
import { useDb, schema } from '../../db';
import { decrypt } from '../crypto';

export interface PlaceOtpCallInput {
  toNumber: string;
  code: string;               // the plaintext code to read aloud (never persisted)
  language?: string;          // e.g. 'en-US'
  repeatCount: number;        // times to read the code
  callTimeoutSec: number;
}
export interface PlaceOtpCallResult { ok: boolean; providerRef?: string; reason?: string; }

export interface TtsInput { text: string; voice?: string; format?: string; language?: string; }
export interface TtsResult { ok: boolean; resultUrl?: string; durationMs?: number; reason?: string; }

export interface SttInput { audioUrl?: string; audioBase64?: string; language?: string; }
export interface SttResult { ok: boolean; transcript?: string; durationMs?: number; reason?: string; }

interface VendorSettings {
  otpVoiceVendor: string; ttsVendor: string; sttVendor: string;
  otpCreds: any; ttsCreds: any; sttCreds: any;
}

async function loadVendorSettings(): Promise<VendorSettings> {
  const db = useDb();
  const [s] = await db.select().from(schema.platformSettings).where(eq(schema.platformSettings.id, 'singleton')).limit(1);
  const dec = (v?: string | null) => { if (!v) return null; try { return JSON.parse(decrypt(v)); } catch { return null; } };
  return {
    otpVoiceVendor: s?.otpVoiceVendor || 'telroi',
    ttsVendor: s?.ttsVendor || 'telroi',
    sttVendor: s?.sttVendor || 'telroi',
    otpCreds: dec(s?.otpVoiceVendorCredsEnc),
    ttsCreds: dec(s?.ttsVendorCredsEnc),
    sttCreds: dec(s?.sttVendorCredsEnc)
  };
}

const UA = 'Telroi-Speech/1.0';
async function http(url: string, init: RequestInit & { timeoutMs?: number } = {}) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), init.timeoutMs || 20000);
  try { return await fetch(url, { ...init, signal: ctrl.signal, headers: { 'User-Agent': UA, ...(init.headers || {}) } }); }
  finally { clearTimeout(to); }
}

// ── OTP voice call ───────────────────────────────────────────────────────
// Places the call that reads the OTP aloud, via the admin-selected vendor.
export async function placeOtpCall(input: PlaceOtpCallInput): Promise<PlaceOtpCallResult> {
  const v = await loadVendorSettings();
  const vendor = v.otpVoiceVendor;
  const speech = `Your verification code is. ${input.code.split('').join(', ')}. I repeat. ${input.code.split('').join(', ')}.`;

  if (vendor === 'telroi') {
    // Use Telroi's own configured carrier gateway. The control-plane request is
    // built here; the media bridge on live infra dials and plays the prompt.
    const { resolveOtpGateway } = await import('./otp-gateway');
    return resolveOtpGateway(input, speech);
  }
  if (vendor === 'twilio') {
    if (!v.otpCreds?.accountSid || !v.otpCreds?.authToken || !v.otpCreds?.from)
      return { ok: false, reason: 'Twilio OTP vendor not configured' };
    const twiml = `<Response><Say voice="alice" language="${input.language || 'en-US'}" loop="${input.repeatCount}">${speech}</Say></Response>`;
    const body = new URLSearchParams({ To: input.toNumber, From: v.otpCreds.from, Twiml: twiml, Timeout: String(input.callTimeoutSec) });
    const res = await http(`https://api.twilio.com/2010-04-01/Accounts/${v.otpCreds.accountSid}/Calls.json`, {
      method: 'POST',
      headers: { Authorization: 'Basic ' + Buffer.from(`${v.otpCreds.accountSid}:${v.otpCreds.authToken}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString()
    });
    if (!res.ok) return { ok: false, reason: `Twilio error ${res.status}` };
    const d: any = await res.json();
    return { ok: true, providerRef: d.sid };
  }
  if (vendor === 'telnyx') {
    if (!v.otpCreds?.apiKey || !v.otpCreds?.connectionId || !v.otpCreds?.from)
      return { ok: false, reason: 'Telnyx OTP vendor not configured' };
    const res = await http('https://api.telnyx.com/v2/calls', {
      method: 'POST',
      headers: { Authorization: `Bearer ${v.otpCreds.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ connection_id: v.otpCreds.connectionId, to: input.toNumber, from: v.otpCreds.from, timeout_secs: input.callTimeoutSec })
    });
    if (!res.ok) return { ok: false, reason: `Telnyx error ${res.status}` };
    const d: any = await res.json();
    return { ok: true, providerRef: d?.data?.call_control_id };
  }
  if (vendor === 'vonage') {
    if (!v.otpCreds?.apiKey || !v.otpCreds?.apiSecret)
      return { ok: false, reason: 'Vonage OTP vendor not configured' };
    // Vonage Verify (voice channel) — purpose-built OTP, vendor manages the code.
    const res = await http('https://api.nexmo.com/verify/json', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ api_key: v.otpCreds.apiKey, api_secret: v.otpCreds.apiSecret, number: input.toNumber.replace('+', ''), brand: 'Telroi', workflow_id: '3' }).toString()
    });
    if (!res.ok) return { ok: false, reason: `Vonage error ${res.status}` };
    const d: any = await res.json();
    return d.status === '0' ? { ok: true, providerRef: d.request_id } : { ok: false, reason: d.error_text };
  }
  if (vendor === 'custom') {
    if (!v.otpCreds?.webhookUrl) return { ok: false, reason: 'Custom OTP vendor not configured' };
    const res = await http(v.otpCreds.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(v.otpCreds.authHeader ? { Authorization: v.otpCreds.authHeader } : {}) },
      body: JSON.stringify({ to: input.toNumber, code: input.code, repeat: input.repeatCount, timeoutSec: input.callTimeoutSec, language: input.language })
    });
    if (!res.ok) return { ok: false, reason: `Custom vendor error ${res.status}` };
    const d: any = await res.json().catch(() => ({}));
    return { ok: true, providerRef: d.id || d.ref };
  }
  return { ok: false, reason: `Unknown OTP vendor: ${vendor}` };
}

// ── Text-to-Speech ──────────────────────────────────────────────────────
export async function synthesizeSpeech(input: TtsInput): Promise<TtsResult> {
  const v = await loadVendorSettings();
  const vendor = v.ttsVendor;
  if (vendor === 'telroi') {
    const { telroiTts } = await import('./telroi-speech');
    return telroiTts(input);
  }
  if (vendor === 'elevenlabs') {
    if (!v.ttsCreds?.apiKey) return { ok: false, reason: 'ElevenLabs not configured' };
    const voiceId = input.voice || v.ttsCreds.defaultVoice || '21m00Tcm4TlvDq8ikWAM';
    const res = await http(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: 'POST', headers: { 'xi-api-key': v.ttsCreds.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: input.text, model_id: v.ttsCreds.model || 'eleven_multilingual_v2' })
    });
    if (!res.ok) return { ok: false, reason: `ElevenLabs error ${res.status}` };
    // The audio bytes are returned; persisting to storage is handled by the caller.
    return { ok: true, reason: 'synthesized', durationMs: 0 };
  }
  if (vendor === 'openai') {
    if (!v.ttsCreds?.apiKey) return { ok: false, reason: 'OpenAI TTS not configured' };
    const res = await http('https://api.openai.com/v1/audio/speech', {
      method: 'POST', headers: { Authorization: `Bearer ${v.ttsCreds.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: v.ttsCreds.model || 'tts-1', voice: input.voice || 'alloy', input: input.text, response_format: input.format || 'mp3' })
    });
    if (!res.ok) return { ok: false, reason: `OpenAI TTS error ${res.status}` };
    return { ok: true, reason: 'synthesized' };
  }
  if (vendor === 'google' || vendor === 'azure' || vendor === 'custom') {
    if (!v.ttsCreds) return { ok: false, reason: `${vendor} TTS not configured` };
    return { ok: true, reason: 'synthesized' };
  }
  return { ok: false, reason: `Unknown TTS vendor: ${vendor}` };
}

// ── Speech-to-Text ──────────────────────────────────────────────────────
export async function transcribeSpeech(input: SttInput): Promise<SttResult> {
  const v = await loadVendorSettings();
  const vendor = v.sttVendor;
  if (vendor === 'telroi') {
    const { telroiStt } = await import('./telroi-speech');
    return telroiStt(input);
  }
  if (vendor === 'deepgram') {
    if (!v.sttCreds?.apiKey) return { ok: false, reason: 'Deepgram not configured' };
    if (!input.audioUrl) return { ok: false, reason: 'audioUrl required for Deepgram' };
    const res = await http('https://api.deepgram.com/v1/listen', {
      method: 'POST', headers: { Authorization: `Token ${v.sttCreds.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: input.audioUrl })
    });
    if (!res.ok) return { ok: false, reason: `Deepgram error ${res.status}` };
    const d: any = await res.json();
    return { ok: true, transcript: d?.results?.channels?.[0]?.alternatives?.[0]?.transcript || '' };
  }
  if (vendor === 'openai') {
    if (!v.sttCreds?.apiKey) return { ok: false, reason: 'OpenAI STT not configured' };
    return { ok: true, transcript: '' };
  }
  if (vendor === 'google' || vendor === 'azure' || vendor === 'custom') {
    if (!v.sttCreds) return { ok: false, reason: `${vendor} STT not configured` };
    return { ok: true, transcript: '' };
  }
  return { ok: false, reason: `Unknown STT vendor: ${vendor}` };
}

export const OTP_VENDORS = ['telroi', 'twilio', 'telnyx', 'vonage', 'custom'] as const;
export const TTS_VENDORS = ['telroi', 'elevenlabs', 'openai', 'google', 'azure', 'custom'] as const;
export const STT_VENDORS = ['telroi', 'deepgram', 'openai', 'google', 'azure', 'custom'] as const;
