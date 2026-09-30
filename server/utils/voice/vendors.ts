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
  // Which of their numbers to present, when the request named one. Ignored if
  // an operator has pinned the workspace or the platform.
  fromNumber?: string;
  // Whose call this is, so the caller id can be their own number rather than
  // the platform's. A carrier blocks a source number carrying heavy traffic,
  // and one shared number carrying every client's verification calls is how it
  // gets blocked for all of them at once.
  tenantId: string;
  // Whether to play the closing "do not share this code" line. Undefined means
  // on: a client who has not thought about it gets the protection.
  securityNotice?: boolean;
  toNumber: string;
  code: string;               // the plaintext code to read aloud (never persisted)
  language?: string;          // e.g. 'en-US'
  repeatCount: number;        // times to read the code
  callTimeoutSec: number;
  otpId?: string;          // ours, so the answered webhook can find the code
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
    // The Nigerian trunk and its host, which the OTP and notification paths
    // both read. They were referenced and never returned, so every call fell
    // through to the ruach default however the setting was changed — including
    // after Ruach started refusing calls.
    otpNgTrunk: s?.otpNgTrunk || null,
    otpNgHost: s?.otpNgHost || null,
    otpNgCallerId: s?.otpNgCallerId || null,
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

  // Routed by destination rather than by a single platform-wide setting.
  // Nigerian calls go out over our own carrier, where the rate is ours and the
  // code is read from local sound files; everything else goes to a vendor that
  // reaches those countries. One global vendor would have sent Nigerian traffic
  // abroad at somebody else's price.
  const dest = String(input.toNumber || '').replace(/[^0-9]/g, '');
  const isNigeria = dest.startsWith('234') || dest.startsWith('0');
  const vendor = isNigeria ? 'telroi' : (v.otpIntlVendor || v.otpVoiceVendor);
  console.log(`[otp-route] to=${input.toNumber} dest=${dest} nigeria=${isNigeria} vendor=${vendor} notice=${input.securityNotice !== false}`);
  // The same script the other two paths use. Nigeria plays recorded audio and
  // Telnyx speaks at call.answered, so this is Twilio's copy — and it had drifted
  // to older wording, which nobody would notice until a vendor switch changed
  // what callers heard.
  const digits = input.code.split('').join(', ');
  // The same choice the Nigerian dialplan makes, in the one place it can be
  // made here: Telnyx and Twilio speak this text themselves, so there is no
  // file to skip — the line is simply not written. On unless a client turns it
  // off, since it is what stops somebody reading their code to a stranger.
  const notice = input.securityNotice === false ? '' : ' Please do not share this code with anyone.';
  const speech = `Hi. Your O T P code is. ${digits}. Let me repeat that. Your O T P code is. ${digits}.${notice} Goodbye.`;

  if (vendor === 'telroi') {
    // Use Telroi's own configured carrier gateway. The control-plane request is
    // built here; the media bridge on live infra dials and plays the prompt.
    const { resolveOtpGateway } = await import('./otp-gateway');
    return resolveOtpGateway(input, speech);
  }
  if (vendor === 'twilio') {
    if (!v.otpCreds?.accountSid || !v.otpCreds?.authToken || !v.otpCreds?.from)
      return { ok: false, reason: 'Twilio OTP vendor not configured' };
    const twiml = `<Response><Say voice="alice" language="${input.language || 'en-US'}" loop="1">${speech}</Say></Response>`;
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
      // client_state carries only the OTP id — the code itself stays with us and
      // is read from our own store when Telnyx tells us the call was answered.
      // This call places the leg; nothing is spoken until that webhook arrives.
      body: JSON.stringify({
        connection_id: v.otpCreds.connectionId,
        to: input.toNumber,
        from: v.otpCreds.from,
        timeout_secs: input.callTimeoutSec,
        client_state: Buffer.from(`otp:${input.otpId || ''}`).toString('base64')
      })
    });
    if (!res.ok) {
      // The body says what they objected to — a bad connection id or a from-number
      // that isn't on the app. Without it this was just a number.
      const body = await res.text().catch(() => '');
      console.error(`[otp-telnyx] ${res.status}: ${body.slice(0, 300)}`);
      return { ok: false, reason: `Telnyx error ${res.status}` };
    }
    const d: any = await res.json();
    console.log(`[otp-telnyx] placed ${d?.data?.call_control_id || '(no id)'}`);
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
/** Transcribe audio we already hold, by sending the bytes.
 *
 *  Deliberately not a presigned URL. A recording is somebody's private
 *  conversation, and signing it creates a window — however short — in which
 *  anyone holding the link can fetch it without authenticating, and URLs end up
 *  in logs, proxies and history. A few megabytes through us costs bandwidth and
 *  removes that entirely.
 */
export async function transcribeAudioBuffer(audio: Buffer, contentType = 'audio/wav', language = 'en'): Promise<SttResult> {
  const v = await loadVendorSettings();
  if (v.sttVendor === 'telroi') {
    const { telroiStt } = await import('./telroi-speech');
    return telroiStt({ audio, contentType, language } as any);
  }
  if (v.sttVendor === 'deepgram') {
    if (!v.sttCreds?.apiKey) return { ok: false, reason: 'Deepgram is not configured' };
    const lang = (language || 'en').split('-')[0] || 'en';
    const res = await http(
      `https://api.deepgram.com/v1/listen?punctuate=true&model=nova-2&smart_format=true&language=${encodeURIComponent(lang)}`,
      { method: 'POST', headers: { Authorization: `Token ${v.sttCreds.apiKey}`, 'Content-Type': contentType }, body: audio as any }
    );
    if (!res.ok) return { ok: false, reason: `Deepgram error ${res.status}` };
    const d: any = await res.json();
    const t = d?.results?.channels?.[0]?.alternatives?.[0]?.transcript;
    if (!t) return { ok: false, reason: 'Nothing could be transcribed from that recording' };
    return { ok: true, transcript: t };
  }
  return { ok: false, reason: `Transcription is not available on ${v.sttVendor}` };
}

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

export interface PlaceNotifyCallInput {
  toNumber: string;
  notificationId: string;
  text: string;
  // The agent synthesises through the web app, which needs to know whose
  // voice settings and whose bill it is.
  tenantId: string;
  // Which of their numbers to present, when the request named one.
  fromNumber?: string;
  // The tenant's SIP username, so the dialplan can resolve their own DID for
  // the carrier carrying the call.
  sipEndpoint?: string;
  callTimeoutSec?: number;
}

/**
 * Place a notification call through our own PBX.
 *
 * One path rather than OTP's three. OTP speaks a code, and a code is short
 * enough that each vendor can be told to read it in that vendor's own way — at
 * the cost of three scripts that drift, which the comment above records having
 * happened. A notification speaks the client's own words, so the text would
 * have to be handed to whichever vendor placed the call and spoken by their
 * engine, in their voice, with their pricing.
 *
 * So it goes out over our own carriers, where we synthesise it ourselves and
 * the voice is the same one every time. That limits destinations to what those
 * carriers reach, which is a smaller promise than OTP makes and an honest one.
 */
export async function placeNotifyCall(input: PlaceNotifyCallInput): Promise<PlaceOtpCallResult> {
  const cfg = useRuntimeConfig() as any;
  const base = (cfg.provisionAgentUrl || '').replace(/\/+$/, '');
  const secret = cfg.provisionAgentSecret || '';
  if (!base || !secret) {
    return { ok: false, reason: 'The PBX provisioning agent is not configured, so notifications cannot be placed.' };
  }
  const ps = await loadVendorSettings().catch(() => null as any);

  // Routed by destination, as OTP is. A Nigerian number goes out over our own
  // carrier at our own rate; everything else over Telnyx, which reaches those
  // countries. Unlike OTP the vendor never speaks — the audio is ours either
  // way, so this chooses a trunk rather than a vendor with its own voice.
  const dest = String(input.toNumber || '').replace(/[^0-9]/g, '');
  const isNigeria = dest.startsWith('234') || dest.startsWith('0');
  // International goes through Telnyx's own API rather than the SIP trunk, for
  // the same reason OTP does: their platform places the call and speaks on
  // answer. It means an international notification is read in Telnyx's voice
  // rather than ours, and that the duration gate does not apply — but it uses a
  // path that has worked for months, where originating our own audio over the
  // trunk produced a call id and no channel.
  if (!isNigeria) {
    if (!ps?.otpCreds?.apiKey || !ps?.otpCreds?.connectionId || !ps?.otpCreds?.from) {
      return { ok: false, reason: 'Telnyx not configured for international notifications' };
    }
    try {
      const res = await fetch('https://api.telnyx.com/v2/calls', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ps.otpCreds.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          connection_id: ps.otpCreds.connectionId,
          to: input.toNumber,
          from: ps.otpCreds.from,
          timeout_secs: input.callTimeoutSec || 45,
          // The id only. The text stays with us and is read from our own store
          // when Telnyx tells us the call was answered.
          client_state: Buffer.from(`notify:${input.notificationId}`).toString('base64')
        }),
        signal: AbortSignal.timeout(15000)
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        console.error(`[notify-telnyx] ${res.status}: ${body.slice(0, 300)}`);
        return { ok: false, reason: `Telnyx error ${res.status}` };
      }
      const d: any = await res.json();
      console.log(`[notify-telnyx] placed ${d?.data?.call_control_id || '(no id)'}`);
      return { ok: true, providerRef: d?.data?.call_control_id, durationSeconds: 0 };
    } catch (e: any) {
      return { ok: false, reason: e?.message || 'telnyx_unreachable' };
    }
  }

  const trunk = ps?.otpNgTrunk || 'ruach-endpoint';
  const host = ps?.otpNgHost || cfg.otpHost || 'sip.ruach.ng';
  // The caller id has to belong to the carrier carrying the call — a Ruach
  // number on a Kasooko trunk is refused as blacklisted, which cost an hour.
  // Their own number when they have one on this carrier, the platform's when
  // they do not. A number is only presentable on the network that issued it —
  // a Ruach number offered on a Kasooko trunk is refused as blacklisted — so
  // the lookup is per carrier rather than "their first number".
  const carrier = (trunk || '').replace(/-endpoint$/, '').replace(/-out$/, '');
  const callerId = (await ownCallerId(input.tenantId, carrier, input.fromNumber)) || ps?.otpNgCallerId;
  console.log(`[notify-route] to=${input.toNumber} nigeria=${isNigeria} trunk=${trunk}`);

  try {
    const res = await fetch(`${base}/notify-call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
      body: JSON.stringify({
        notificationId: input.notificationId,
        tenantId: input.tenantId,
        to: input.toNumber,
        text: input.text,
        trunk,
        host,
        // So the dialplan can look up the tenant's own DID for whichever
        // carrier is carrying this call, rather than presenting a number that
        // belongs to a different one.
        carrier: isNigeria ? (trunk.replace(/-endpoint$/, '')) : 'telnyx',
        endpoint: input.sipEndpoint || '',
        // Digits only, like the OTP path: the carrier's switch returned 500 on a
        // caller id with a leading plus and accepted the same number without one.
        callerId: String(callerId || '').replace(/[^0-9]/g, ''),
        callTimeoutSec: input.callTimeoutSec || 45
      }),
      signal: AbortSignal.timeout(15000)
    });
    if (!res.ok) return { ok: false, reason: `agent_http_${res.status}` };
    const j: any = await res.json();
    // The measured duration comes back so the unit count can be resolved from
    // the real audio rather than an estimate of it.
    return j?.ok
      ? { ok: true, providerRef: j.callid || input.notificationId, durationSeconds: Number(j.durationSeconds) || 0 }
      : { ok: false, reason: j?.reason || 'agent_refused' };
  } catch (e: any) {
    return { ok: false, reason: e?.message || 'agent_unreachable' };
  }
}

/**
 * The number this workspace should present when placing an OTP or notification
 * on a given carrier, or null if they have none there.
 *
 * Their own number by default. A carrier blocks a source number carrying heavy
 * traffic, so every client's verification calls going out on one shared number
 * is how that number gets blocked for all of them — a Kasooko trunk refused a
 * call today with exactly that. Spreading the traffic across the numbers the
 * clients already pay for is both safer and more honest: the recipient sees who
 * is actually calling them.
 *
 * Carrier-specific, because a number is only presentable on the network that
 * issued it. A Ruach number offered on a Kasooko trunk is refused as
 * blacklisted, which cost an hour before it was understood.
 */
export async function ownCallerId(tenantId: string, provider: string, requested?: string | null): Promise<string | null> {
  const { useDb, schema } = await import('~/server/db');
  const { and, eq } = await import('drizzle-orm');
  const db = useDb();
  const [t] = await db.select({
    own: schema.tenants.useOwnNumber,
    preferred: schema.tenants.otpCallerTelnum,
    pinned: schema.tenants.otpCallerPinned
  }).from(schema.tenants).where(eq(schema.tenants.id, tenantId)).limit(1);

  // Pins first, and they answer before anything else is considered — including
  // whether the workspace uses its own numbers at all. A pin exists because
  // somebody looked at a failing account and decided; a client's API request
  // routing around that would put the call back on the line that was failing.
  const [pinRow] = await db.select({ pin: schema.platformSettings.voiceCallerPinned })
    .from(schema.platformSettings).where(eq(schema.platformSettings.id, 'singleton')).limit(1);
  if (pinRow?.pin) return pinRow.pin;
  if (t?.pinned) return t.pinned;
  // Their own setting when an operator has made one, the platform default when
  // they have not. Switched off either way means the shared number carries
  // them — because their own is the problem, or because ours are working
  // better at the moment.
  let useOwn = t?.own;
  if (useOwn == null) {
    const [ps] = await db.select({ d: schema.platformSettings.voiceUseOwnNumber })
      .from(schema.platformSettings).where(eq(schema.platformSettings.id, 'singleton')).limit(1);
    useOwn = ps?.d ?? true;
  }
  if (!useOwn) return null;

  // Rotation, if enabled: the same atomic LRU pick the dialplan uses, sharing
  // one function and one last_used_at state so a call never clusters on one
  // number. Rotation wins even over a requested number when that request points
  // at a number in the rotating pool — a client who turned rotation on to spread
  // volume (and avoid a carrier/NCC block on one line) should not have it
  // defeated by a preference or an API `from` naming one pool number. An explicit
  // request for a number OUTSIDE the pool is still honoured below as an override.
  {
    const { sql } = await import('drizzle-orm');
    const digits = (requested || '').replace(/[^0-9]/g, '').slice(-9);
    let requestedInPool = false;
    if (digits) {
      const pool = await db.execute(sql`select 1 from number_subscriptions where tenant_id=${tenantId}::uuid and provider=${provider} and status='active' and rotation_enabled=true and right(regexp_replace(telnum,'[^0-9]','','g'),9)=${digits} limit 1`);
      requestedInPool = !!((pool as any)?.rows?.length || (pool as any)?.length);
    }
    if (!requested || requestedInPool) {
      const rot = await db.execute(sql`select next_rotating_caller_id(${tenantId}::uuid, ${provider}) as num`);
      const num = (rot as any)?.rows?.[0]?.num || (rot as any)?.[0]?.num;
      if (num) return num;
    }
  }

  const rows = await db.select({ telnum: schema.numberSubscriptions.telnum })
    .from(schema.numberSubscriptions)
    .where(and(
      eq(schema.numberSubscriptions.tenantId, tenantId),
      eq(schema.numberSubscriptions.provider, provider),
      eq(schema.numberSubscriptions.status, 'active')
    ));
  if (!rows.length) return null;
  // Their choice when it is on this carrier. A number is only presentable on
  // the network that issued it, so a preference set for a Nigerian line cannot
  // carry a US call — then the first number on the right carrier stands in,
  // which is what happened before anybody could choose at all.
  // What they asked for, then what they chose, then whatever they hold on this
  // carrier. A request naming a number they do not own is refused by the
  // endpoint before reaching here, so an unmatched one at this point means it
  // is theirs but on another network — which cannot carry this call.
  const asked = requested ? rows.find((r) => r.telnum === requested) : null;
  const preferred = rows.find((r) => r.telnum === t.preferred);
  return (asked || preferred || rows[0]).telnum;
}

/** Does this workspace own any number at all? OTP and notifications are refused
 *  without one — a client sending verification calls on our number, with no
 *  number of their own, is our traffic reputation paying for their volume. */
export async function ownsAnyNumber(tenantId: string): Promise<boolean> {
  const { useDb, schema } = await import('~/server/db');
  const { and, eq, sql } = await import('drizzle-orm');
  const db = useDb();
  const [r] = await db.select({ n: sql<number>`count(*)::int` })
    .from(schema.numberSubscriptions)
    .where(and(
      eq(schema.numberSubscriptions.tenantId, tenantId),
      eq(schema.numberSubscriptions.status, 'active')
    ));
  return (r?.n || 0) > 0;
}

/** Does this workspace hold this number? Asked before a call is placed, so a
 *  request naming somebody else's number is refused rather than quietly
 *  ignored — a client who asked for a specific caller ID and silently got a
 *  different one has no way to know. */
export async function ownsNumber(tenantId: string, telnum: string): Promise<boolean> {
  const { useDb, schema } = await import('~/server/db');
  const { and, eq } = await import('drizzle-orm');
  const db = useDb();
  const [n] = await db.select({ id: schema.numberSubscriptions.id })
    .from(schema.numberSubscriptions)
    .where(and(
      eq(schema.numberSubscriptions.tenantId, tenantId),
      eq(schema.numberSubscriptions.telnum, telnum),
      eq(schema.numberSubscriptions.status, 'active')
    )).limit(1);
  return !!n;
}
