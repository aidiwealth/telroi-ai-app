// control-app/src/media-shared.ts
// What both carrier media adapters need.
//
// The tuning below was arrived at against real calls, and a caller shouldn't be
// able to tell which carrier carried them — so it lives in one place rather than
// being copied per adapter, where the two would quietly drift apart the first
// time somebody adjusted one. The protocol handling stays separate: that is
// where the carriers genuinely differ.
import { ttsToMuLaw } from './audio-out.ts';

export const WEBAPP_URL = process.env.WEBAPP_URL || 'https://app.telroi.ai';
export const INTERNAL_SECRET = process.env.PROVISION_AGENT_SECRET || '';
export const PBX_SIP_HOST = process.env.PBX_SIP_HOST || 'sip.telroi.ai';

export const FILLER_PHRASES = ['Mm-hm.', 'One moment.', 'Sure, let me check.'];
// Only fills when the brain is actually slow. Firing every turn makes the AI
// sound like it's stalling; a person only fills a real pause.
export const FILLER_DELAY_MS = 2500;

// Both carriers deliver 8kHz mu-law, so these hold for either.
export const SPEECH_ON = 700;        // above this = speech
export const SPEECH_OFF = 400;       // below this = quiet
export const SILENCE_FRAMES = 25;    // ~500ms of quiet ends the turn
export const MIN_SPEECH_FRAMES = 10; // ignore blips under ~200ms
export const MAX_TURN_FRAMES = 750;  // ~15s hard cap per turn

export interface Meta {
  agentId?: string;
  tenantId?: string;
  telnum?: string;
  escalateTo?: string | null;
  escalateAfter?: number;
  escalateMode?: string | null;
}

/** One turn of conversation: audio in, reply and speech out. */
export async function callTurn(payload: Record<string, unknown>, log: (...a: unknown[]) => void) {
  try {
    const res = await fetch(`${WEBAPP_URL}/api/voice/ai/turn`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-telroi-internal': INTERNAL_SECRET },
      body: JSON.stringify(payload)
    });
    if (!res.ok) { log('turn HTTP', res.status); return null; }
    return await res.json() as any;
  } catch (e) {
    log('turn error:', (e as Error).message);
    return null;
  }
}

/** Pre-render an acknowledgement in this agent's own voice. */
export async function renderFiller(tenantId: string, agentId: string, text: string): Promise<Buffer | null> {
  try {
    const res = await fetch(`${WEBAPP_URL}/api/voice/ai/whisper-tts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-telroi-internal': INTERNAL_SECRET },
      body: JSON.stringify({ tenantId, agentId, text })
    });
    if (!res.ok) return null;
    const j = await res.json() as any;
    if (!j?.audioBase64) return null;
    return await ttsToMuLaw(j.audioBase64, j.audioContentType || 'audio/wav');
  } catch { return null; }
}

/**
 * Where a human handoff should go. A phone number the carrier can dial directly;
 * anything else means the dashboard agents, who are registered to our own PBX and
 * so have to be reached through it.
 */
export function escalationTarget(meta: Meta, callId?: string | null): string | null {
  const mode = meta.escalateMode || 'none';
  if (mode === 'phone') return meta.escalateTo || null;
  if (mode === 'ring_all' || mode === 'endpoint') {
    const did = (meta.telnum || '').replace(/[^0-9+]/g, '');
    if (!did) return null;
    // The id goes in a SIP user part, which can't carry a colon — one carrier's
    // ids are plain but the other's look like "v3:WLUG...", and that colon made
    // the whole address invalid, so the handoff never arrived. Hex-encode it and
    // decode on the way back.
    const tag = callId ? Buffer.from(String(callId), 'utf8').toString('hex') : '';
    return `sip:esc-${did}--${tag}@${PBX_SIP_HOST}`;
  }
  return null;
}
