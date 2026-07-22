// control-app/src/telnyx-media.ts
// Telnyx AI media adapter. Telnyx forks call audio here over a WebSocket
// (streaming_start). This is Telnyx's equivalent of ai-call.ts (Asterisk): it
// captures the caller's speech, drives the SAME brain (/api/voice/ai/turn), and
// will stream the reply back. The brain is carrier-agnostic; only capture and
// playback differ per carrier.
//
// Frames: base64 PCMU (mu-law) 8kHz mono, 160 bytes = 20ms each, ~50/sec.
// Turn detection: simple energy VAD — speech starts when energy crosses a
// threshold, ends after a run of quiet frames. STAGE 2: transcribe + log.
import { WebSocketServer, type WebSocket } from 'ws';
import type http from 'node:http';
import { muLawToPcm16, pcm16ToWav, pcm16Energy } from './audio-mulaw.ts';
import { ttsToMuLaw, streamMuLaw } from './audio-out.ts';

const WEBAPP_URL = process.env.WEBAPP_URL || 'https://app.telroi.ai';

// Short acknowledgements played the instant the caller stops talking, masking the
// ~3s STT+LLM+TTS gap. Humans do this ("mm-hm", "let me see") — without it the
// line goes dead and callers think the AI didn't hear them. Rendered once at
// startup from a local tone-free source so playing one costs nothing.
const FILLER_PHRASES = ['Mm-hm.', 'One moment.', 'Sure, let me check.'];
// Only fill if the brain hasn't answered within this long — fast turns stay clean.
const FILLER_DELAY_MS = 2500;

// Render a short line in the agent's own voice via the TTS-only endpoint, and
// return it as ready-to-stream mu-law. Used to pre-warm per-call fillers.
async function renderFiller(tenantId: string, agentId: string, text: string): Promise<Buffer | null> {
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
const INTERNAL_SECRET = process.env.PROVISION_AGENT_SECRET || '';

// VAD tuning (mean |amplitude| of PCM16 per 20ms frame).
const SPEECH_ON = 700;      // above this = speech
const SPEECH_OFF = 400;     // below this = quiet
const SILENCE_FRAMES = 25;  // ~500ms of quiet ends the turn (tuned for phone pace)
const MIN_SPEECH_FRAMES = 10; // ignore blips under ~200ms
const MAX_TURN_FRAMES = 750;  // ~15s hard cap per turn

function log(...args: unknown[]) {
  console.log(new Date().toISOString(), '[telnyx-media]', ...args);
}

interface Meta { agentId?: string; tenantId?: string; telnum?: string; escalateTo?: string | null; escalateAfter?: number; escalateMode?: string | null }

// Hand the call off to a human. The AI has already spoken the "connecting you"
// line by this point, so we just issue the Call Control transfer. Note Telnyx can
// only dial a PSTN number or SIP URI — an internal dashboard-agent endpoint needs
// the SIP-handoff path instead (not wired yet).
async function telnyxTransfer(callControlId: string, to: string): Promise<boolean> {
  // Goes through the web app: it holds the Telnyx credentials (encrypted platform
  // settings), so the PBX box never needs a copy of the API key.
  try {
    const res = await fetch(`${WEBAPP_URL}/api/voice/ai/telnyx-transfer`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-telroi-internal': INTERNAL_SECRET },
      body: JSON.stringify({ callId: callControlId, to })
    });
    const j = await res.json().catch(() => ({})) as any;
    if (!res.ok || !j?.ok) { log(`transfer -> ${to} failed:`, j?.error || `HTTP ${res.status}`); return false; }
    log(`transfer -> ${to} OK`);
    return true;
  } catch (e) { log('transfer error:', (e as Error).message); return false; }
}

async function callTurn(payload: Record<string, unknown>) {
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

export function attachTelnyxMedia(server: http.Server, path = '/telnyx-media') {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    let url = '';
    try { url = new URL(req.url || '', 'http://127.0.0.1').pathname; } catch { url = req.url || ''; }
    if (url !== path) return;
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  wss.on('connection', (ws: WebSocket) => {
    let callId: string | null = null;
    let meta: Meta = {};
    let history: Array<{ role: string; content: string }> = [];
    let frames = 0;

    // Turn state
    let speaking = false;
    let quietRun = 0;
    let speechFrames = 0;
    let buf: Buffer[] = [];
    let busy = false; // don't start a new turn while one is in flight
    let peakEnergy = 0, sumEnergy = 0, energyCount = 0;
    let idleSamples: number[] = []; // rolling sample of non-speech energy (noise floor)
    let playback: { cancel: () => void } | null = null;
    let playing = false;
    let fillers: Buffer[] = []; // pre-rendered acknowledgements in this agent's voice
    // Once the call is handed to a human, the AI is done: Telnyx keeps the media
    // stream open for a moment, and without this latch the adapter kept
    // transcribing the agent's conversation and even re-issuing transfers.
    let handedOff = false;

    const sendMedia = (b64: string) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ event: 'media', media: { payload: b64 } }));
    };

    // Convert the brain's TTS to mu-law and stream it to the caller. Cancels any
    // in-flight playback first so a new reply supersedes the old one.
    async function speak(b64: string | null, contentType: string | null, label: string) {
      if (!b64) return;
      const mu = await ttsToMuLaw(b64, contentType || 'audio/wav');
      if (!mu) { log(`${label}: mu-law convert failed`); return; }
      // If a filler is still speaking, let it finish rather than chopping a word —
      // fillers are ~1s and the brain takes ~3s, so this rarely waits at all.
      const waitStart = Date.now();
      while (playing && Date.now() - waitStart < 1500) await new Promise((r) => setTimeout(r, 50));
      playback?.cancel();
      playing = true;
      log(`${label}: playing ${(mu.length / 8000).toFixed(2)}s (${Math.ceil(mu.length / 160)} frames)`);
      playback = streamMuLaw(mu, sendMedia, () => { playing = false; log(`${label}: playback done`); });
    }

    // Where a human handoff should go. A phone target is dialed by Telnyx directly.
    // ring_all/endpoint mean "ring the dashboard agents" — those are WebRTC endpoints
    // registered to OUR Asterisk, which Telnyx can't see, so we send the call back
    // to our PBX over SIP (esc- prefix tells Stasis it's an escalation, not a new
    // inbound call to re-answer with the AI).
    const PBX_SIP_HOST = process.env.PBX_SIP_HOST || 'sip.telroi.ai';
    function escalationTarget(): string | null {
      const mode = meta.escalateMode || 'none';
      if (mode === 'phone') return meta.escalateTo || null;
      if (mode === 'ring_all' || mode === 'endpoint') {
        const did = (meta.telnum || '').replace(/[^0-9+]/g, '');
        if (!did) return null;
        return `sip:esc-${did}@${PBX_SIP_HOST}`;
      }
      return null;
    }

    const resetTurn = () => { speaking = false; quietRun = 0; speechFrames = 0; buf = []; peakEnergy = 0; sumEnergy = 0; energyCount = 0; };

    async function finishTurn() {
      if (handedOff || busy || speechFrames < MIN_SPEECH_FRAMES) { resetTurn(); return; }
      busy = true;
      // Only fill if the brain is actually being slow. Firing on every turn makes
      // the AI sound like it's stalling constantly; a human only fills a real
      // pause. If the reply lands inside FILLER_DELAY_MS, the caller never hears one.
      let replied = false;
      const fillerTimer = setTimeout(() => {
        if (replied || !fillers.length) return;
        const f = fillers[Math.floor(Math.random() * fillers.length)];
        playback?.cancel();
        playing = true;
        log('filler: covering slow turn');
        playback = streamMuLaw(f, sendMedia, () => { playing = false; });
      }, FILLER_DELAY_MS);
      const pcm = Buffer.concat(buf);
      const peak = peakEnergy; const avg = sumEnergy / Math.max(1, energyCount);
      resetTurn();
      const wav = pcm16ToWav(pcm, 8000);
      log(`turn: ${(pcm.length / 2 / 8000).toFixed(2)}s speech, energy avg=${avg.toFixed(0)} peak=${peak.toFixed(0)} -> STT`);
      const t = await callTurn({
        agentId: meta.agentId, tenantId: meta.tenantId, telnum: meta.telnum,
        callId, history, audioBase64: wav.toString('base64'), audioContentType: 'audio/wav'
      });
      replied = true; clearTimeout(fillerTimer);
      if (t) {
        log(`TRANSCRIPT/REPLY: reply="${String(t.reply || '').slice(0, 120)}" audio=${t.audioBase64 ? 'yes' : 'no'} action=${t.action || 'continue'}`);
        if (Array.isArray(t.history)) history = t.history;
        await speak(t.audioBase64, t.audioContentType, 'REPLY');
        if (t.action === 'transfer') {
          const target = escalationTarget();
          if (!target) {
            log(`transfer requested but no target for mode=${meta.escalateMode || 'none'} — staying with the AI`);
          } else {
            // Let the "connecting you" line finish before the call moves.
            const waited = Date.now();
            while (playing && Date.now() - waited < 12000) await new Promise((r) => setTimeout(r, 100));
            if (callId && await telnyxTransfer(callId, target)) {
              handedOff = true;
              playback?.cancel(); playing = false;
              log('handed off to a human — AI stopping');
            }
          }
        }
      }
      busy = false;
    }

    ws.on('message', async (data: Buffer) => {
      let msg: any;
      try { msg = JSON.parse(data.toString()); } catch { return; }

      if (msg.event === 'start') {
        callId = msg.start?.call_control_id || null;
        try {
          const cs = msg.start?.client_state;
          if (cs) meta = JSON.parse(Buffer.from(cs, 'base64').toString('utf8'));
        } catch { /* no meta */ }
        log('START call:', callId, 'agent:', meta.agentId || '?', 'tenant:', meta.tenantId || '?', 'fmt:', JSON.stringify(msg.start?.media_format || {}));
        // Greeting turn (first=true) — STAGE 3 will play the returned audio.
        if (meta.agentId && meta.tenantId) {
          const g = await callTurn({ agentId: meta.agentId, tenantId: meta.tenantId, telnum: meta.telnum, callId, first: true });
          if (g) {
            log(`GREETING: "${String(g.reply || '').slice(0, 120)}" audio=${g.audioBase64 ? 'yes' : 'no'}`);
            if (Array.isArray(g.history)) history = g.history;
            await speak(g.audioBase64, g.audioContentType, 'GREETING');
            // Warm the fillers while the greeting plays — ready before turn 1.
            Promise.all(FILLER_PHRASES.map((p) => renderFiller(meta.tenantId!, meta.agentId!, p)))
              .then((rs) => { fillers = rs.filter((x): x is Buffer => !!x); log(`fillers ready: ${fillers.length}/${FILLER_PHRASES.length}`); })
              .catch(() => {});
          }
        } else {
          log('WARN: no agent/tenant in client_state — cannot drive the brain');
        }
        return;
      }

      if (msg.event === 'media') {
        frames++;
        if (handedOff) return; // the human owns this call now
        const b64 = msg.media?.payload; if (!b64) return;
        const pcm = muLawToPcm16(Buffer.from(b64, 'base64'));
        const energy = pcm16Energy(pcm);

        // While our own audio is playing, skip capture — otherwise the AI hears
        // itself (inbound_track shouldn't echo, but this also avoids turn overlap).
        if (playing) return;

        if (!speaking) {
          // Sample the ambient noise floor so we can tune SPEECH_ON from real data.
          idleSamples.push(energy);
          if (idleSamples.length >= 250) { // ~5s
            const sorted = [...idleSamples].sort((a, b) => a - b);
            log(`noise floor: p50=${sorted[125].toFixed(0)} p90=${sorted[225].toFixed(0)} max=${sorted[249].toFixed(0)} (SPEECH_ON=${SPEECH_ON})`);
            idleSamples = [];
          }
          if (energy > SPEECH_ON) { speaking = true; speechFrames = 1; quietRun = 0; buf = [pcm]; peakEnergy = energy; sumEnergy = energy; energyCount = 1; }
          return;
        }
        buf.push(pcm); speechFrames++;
        if (energy > peakEnergy) peakEnergy = energy; sumEnergy += energy; energyCount++;
        if (energy < SPEECH_OFF) quietRun++; else quietRun = 0;
        if (quietRun >= SILENCE_FRAMES || speechFrames >= MAX_TURN_FRAMES) await finishTurn();
        return;
      }

      if (msg.event === 'stop') {
        playback?.cancel(); playing = false;
        log('STOP call:', callId, 'frames:', frames);
        return;
      }
    });

    ws.on('close', () => { playback?.cancel(); log('closed — frames:', frames); });
    ws.on('error', (e) => log('ws error:', (e as Error).message));
  });

  log('Telnyx media WS attached at', path);
  return wss;
}
