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

const WEBAPP_URL = process.env.WEBAPP_URL || 'https://app.telroi.ai';
const INTERNAL_SECRET = process.env.PROVISION_AGENT_SECRET || '';

// VAD tuning (mean |amplitude| of PCM16 per 20ms frame).
const SPEECH_ON = 700;      // above this = speech
const SPEECH_OFF = 400;     // below this = quiet
const SILENCE_FRAMES = 40;  // ~800ms of quiet ends the turn
const MIN_SPEECH_FRAMES = 10; // ignore blips under ~200ms
const MAX_TURN_FRAMES = 750;  // ~15s hard cap per turn

function log(...args: unknown[]) {
  console.log(new Date().toISOString(), '[telnyx-media]', ...args);
}

interface Meta { agentId?: string; tenantId?: string; telnum?: string }

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

    const resetTurn = () => { speaking = false; quietRun = 0; speechFrames = 0; buf = []; };

    async function finishTurn() {
      if (busy || speechFrames < MIN_SPEECH_FRAMES) { resetTurn(); return; }
      busy = true;
      const pcm = Buffer.concat(buf);
      resetTurn();
      const wav = pcm16ToWav(pcm, 8000);
      log(`turn: ${(pcm.length / 2 / 8000).toFixed(2)}s of speech -> STT`);
      const t = await callTurn({
        agentId: meta.agentId, tenantId: meta.tenantId, telnum: meta.telnum,
        callId, history, audioBase64: wav.toString('base64'), audioContentType: 'audio/wav'
      });
      if (t) {
        log(`TRANSCRIPT/REPLY: reply="${String(t.reply || '').slice(0, 120)}" audio=${t.audioBase64 ? 'yes' : 'no'} action=${t.action || 'continue'}`);
        if (Array.isArray(t.history)) history = t.history;
        // STAGE 3 will stream t.audioBase64 back to the caller here.
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
          }
        } else {
          log('WARN: no agent/tenant in client_state — cannot drive the brain');
        }
        return;
      }

      if (msg.event === 'media') {
        frames++;
        const b64 = msg.media?.payload; if (!b64) return;
        const pcm = muLawToPcm16(Buffer.from(b64, 'base64'));
        const energy = pcm16Energy(pcm);

        if (!speaking) {
          if (energy > SPEECH_ON) { speaking = true; speechFrames = 1; quietRun = 0; buf = [pcm]; }
          return;
        }
        buf.push(pcm); speechFrames++;
        if (energy < SPEECH_OFF) quietRun++; else quietRun = 0;
        if (quietRun >= SILENCE_FRAMES || speechFrames >= MAX_TURN_FRAMES) await finishTurn();
        return;
      }

      if (msg.event === 'stop') {
        log('STOP call:', callId, 'frames:', frames);
        return;
      }
    });

    ws.on('close', () => log('closed — frames:', frames));
    ws.on('error', (e) => log('ws error:', (e as Error).message));
  });

  log('Telnyx media WS attached at', path);
  return wss;
}
