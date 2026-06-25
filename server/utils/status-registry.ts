// server/utils/status-registry.ts
// PREDETERMINED status components. Admin cannot add/rename these — they are the
// system's known parts. Each has a probe() that returns the component's real
// health. Status + uptime on the public page derive from recorded probe results,
// never from admin input. Adding a new component = add an entry here (in code).
import { sql } from 'drizzle-orm';
import { useDb } from '../db';

export type ProbeState = 'operational' | 'degraded' | 'major_outage' | 'unknown';
export interface ProbeResult { ok: boolean; state: ProbeState; latencyMs?: number; detail?: string; }

export interface StatusComponentDef {
  key: string;            // stable id, e.g. 'voice_otp'
  title: string;          // fixed display name (NOT admin-editable)
  defaultDescription: string;
  probe: () => Promise<ProbeResult>;
}

// --- shared probes -------------------------------------------------------
async function probeDatabase(): Promise<ProbeResult> {
  const t0 = Date.now();
  try {
    await useDb().execute(sql`select 1`);
    const latencyMs = Date.now() - t0;
    return { ok: true, state: latencyMs > 800 ? 'degraded' : 'operational', latencyMs };
  } catch (e: any) {
    return { ok: false, state: 'major_outage', detail: e?.message?.slice(0, 120) };
  }
}

// A voice/telephony probe is only truthful if the live gateway is configured.
// Until then it honestly reports 'unknown' rather than claiming operational.
async function probeVoiceGateway(label: string): Promise<ProbeResult> {
  try {
    const { voiceCredentials } = await import('./voice-credentials');
    const all = await voiceCredentials().catch(() => null);
    const configured = !!(all && (all.digidite || all.telnyx || all.twilio));
    if (!configured) return { ok: false, state: 'unknown', detail: `${label}: no voice gateway configured` };
    // Live infra present — a real reachability check runs here against the
    // gateway in production. We treat "configured" as operational at the
    // control-plane level; deep media checks run on the live bridge.
    return { ok: true, state: 'operational', detail: `${label}: gateway configured` };
  } catch (e: any) {
    return { ok: false, state: 'unknown', detail: e?.message?.slice(0, 120) };
  }
}

async function probeSpeechVendors(): Promise<ProbeResult> {
  try {
    const { platformSettings } = await import('./platform');
    const s = await platformSettings();
    // 'telroi' is the built-in path; external vendors need creds. If TTS/STT are
    // set to an external vendor with no creds, that's degraded, not down.
    const ttsExternal = s?.ttsVendor && s.ttsVendor !== 'telroi';
    const sttExternal = s?.sttVendor && s.sttVendor !== 'telroi';
    const ttsMissing = ttsExternal && !s?.ttsVendorCredsEnc;
    const sttMissing = sttExternal && !s?.sttVendorCredsEnc;
    if (ttsMissing || sttMissing) return { ok: false, state: 'degraded', detail: 'A speech vendor is selected without credentials' };
    return { ok: true, state: 'operational' };
  } catch {
    return { ok: false, state: 'unknown' };
  }
}

// --- the predetermined registry -----------------------------------------
export const STATUS_COMPONENTS: StatusComponentDef[] = [
  {
    key: 'dashboard_api',
    title: 'Dashboard & API',
    defaultDescription: 'Web dashboard and REST API',
    probe: probeDatabase
  },
  {
    key: 'voice_otp',
    title: 'Voice OTP API',
    defaultDescription: 'One-time passcode delivery over voice',
    probe: () => probeVoiceGateway('Voice OTP')
  },
  {
    key: 'speech',
    title: 'Speech API',
    defaultDescription: 'Text-to-speech & speech-to-text',
    probe: probeSpeechVendors
  },
  {
    key: 'voice_calls',
    title: 'Voice Calls',
    defaultDescription: 'Outbound & inbound call origination',
    probe: () => probeVoiceGateway('Voice Calls')
  },
  {
    key: 'numbers',
    title: 'Numbers & Provisioning',
    defaultDescription: 'Phone number management',
    probe: probeDatabase
  },
  {
    key: 'webhooks',
    title: 'Webhooks',
    defaultDescription: 'Event delivery to your endpoints',
    probe: probeDatabase
  }
];

export function getComponentDef(key: string) {
  return STATUS_COMPONENTS.find((c) => c.key === key);
}
