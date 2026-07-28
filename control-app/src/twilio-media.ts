// control-app/src/twilio-media.ts
// AI over Twilio: their Media Streams give us the caller's audio over a
// WebSocket, we drive the same brain the other carrier uses, and stream the
// reply back.
//
// A sibling of telnyx-media: the protocol handling differs per carrier, but the
// tuning that decides how the AI sounds — thresholds, silence detection, filler
// timing — comes from media-shared, so a caller can't tell which carrier carried
// them and the two can't drift apart when somebody adjusts one.
//
// Twilio differences that matter:
//   - every outbound frame needs the streamSid
//   - metadata arrives as <Parameter> values in the start message, not a
//     base64 client_state
//   - a transfer means redirecting the call through their REST API
import { WebSocketServer, type WebSocket } from 'ws';
import type http from 'node:http';
import { muLawToPcm16, pcm16ToWav, pcm16Energy } from './audio-mulaw.ts';
import { ttsToMuLaw, streamMuLaw } from './audio-out.ts';

import {
  WEBAPP_URL, INTERNAL_SECRET, FILLER_PHRASES, FILLER_DELAY_MS,
  SPEECH_ON, SPEECH_OFF, SILENCE_FRAMES, MIN_SPEECH_FRAMES, MAX_TURN_FRAMES,
  callTurn as sharedCallTurn, renderFiller as sharedRenderFiller,
  escalationTarget as sharedEscalationTarget, type Meta
} from './media-shared.ts';

function log(...args: unknown[]) {
  console.log(new Date().toISOString(), '[twilio-media]', ...args);
}

const callTurn = (p: Record<string, unknown>) => sharedCallTurn(p, log);
const renderFiller = sharedRenderFiller;

/** Move the call to a human. The web app holds the credentials, as with the other carrier. */
async function twilioRedirect(callSid: string, to: string): Promise<boolean> {
  try {
    const res = await fetch(`${WEBAPP_URL}/api/voice/ai/twilio-transfer`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-telroi-internal': INTERNAL_SECRET },
      body: JSON.stringify({ callSid, to })
    });
    const j = await res.json().catch(() => ({})) as any;
    if (!res.ok || !j?.ok) { log(`transfer -> ${to} failed:`, j?.error || `HTTP ${res.status}`); return false; }
    log(`transfer -> ${to} OK`);
    return true;
  } catch (e) { log('transfer error:', (e as Error).message); return false; }
}

export function attachTwilioMedia(server: http.Server, path = '/twilio-media') {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    let url = '';
    try { url = new URL(req.url || '', 'http://127.0.0.1').pathname; } catch { url = req.url || ''; }
    if (url !== path) return;
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  wss.on('connection', (ws: WebSocket) => {
    let streamSid: string | null = null;
    let callSid: string | null = null;
    let meta: Meta = {};
    let history: Array<{ role: string; content: string }> = [];
    let frames = 0;

    let speaking = false;
    let quietRun = 0;
    let speechFrames = 0;
    let buf: Buffer[] = [];
    let busy = false;
    let peakEnergy = 0, sumEnergy = 0, energyCount = 0;
    let idleSamples: number[] = [];
    let playback: { cancel: () => void } | null = null;
    let playing = false;
    let fillers: Buffer[] = [];
    let handedOff = false;

    // Every frame back to Twilio must name the stream it belongs to.
    const sendMedia = (b64: string) => {
      if (ws.readyState === ws.OPEN && streamSid) {
        ws.send(JSON.stringify({ event: 'media', streamSid, media: { payload: b64 } }));
      }
    };

    async function speak(b64: string | null, contentType: string | null, label: string) {
      if (!b64) return;
      const mu = await ttsToMuLaw(b64, contentType || 'audio/wav');
      if (!mu) { log(`${label}: mu-law convert failed`); return; }
      const waitStart = Date.now();
      while (playing && Date.now() - waitStart < 1500) await new Promise((r) => setTimeout(r, 50));
      playback?.cancel();
      playing = true;
      log(`${label}: playing ${(mu.length / 8000).toFixed(2)}s (${Math.ceil(mu.length / 160)} frames)`);
      playback = streamMuLaw(mu, sendMedia, () => { playing = false; log(`${label}: playback done`); });
    }

    const escalationTarget = () => sharedEscalationTarget(meta);

    const resetTurn = () => { speaking = false; quietRun = 0; speechFrames = 0; buf = []; peakEnergy = 0; sumEnergy = 0; energyCount = 0; };

    async function finishTurn() {
      if (handedOff || busy || speechFrames < MIN_SPEECH_FRAMES) { resetTurn(); return; }
      busy = true;
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
        callId: callSid, history, audioBase64: wav.toString('base64'), audioContentType: 'audio/wav'
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
            const waited = Date.now();
            while (playing && Date.now() - waited < 12000) await new Promise((r) => setTimeout(r, 100));
            if (callSid && await twilioRedirect(callSid, target)) {
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
        streamSid = msg.streamSid || msg.start?.streamSid || null;
        callSid = msg.start?.callSid || null;
        // Twilio passes our <Parameter> values through here, in place of the
        // base64 client_state the other carrier uses.
        const cp = msg.start?.customParameters || {};
        meta = {
          agentId: cp.agentId, tenantId: cp.tenantId, telnum: cp.telnum,
          escalateTo: cp.escalateTo || null,
          escalateAfter: cp.escalateAfter ? Number(cp.escalateAfter) : 0,
          escalateMode: cp.escalateMode || null
        };
        log('START call:', callSid, 'stream:', streamSid, 'agent:', meta.agentId || '?', 'tenant:', meta.tenantId || '?');
        if (meta.agentId && meta.tenantId) {
          const g = await callTurn({ agentId: meta.agentId, tenantId: meta.tenantId, telnum: meta.telnum, callId: callSid, first: true });
          if (g) {
            log(`GREETING: "${String(g.reply || '').slice(0, 120)}" audio=${g.audioBase64 ? 'yes' : 'no'}`);
            if (Array.isArray(g.history)) history = g.history;
            await speak(g.audioBase64, g.audioContentType, 'GREETING');
            Promise.all(FILLER_PHRASES.map((p) => renderFiller(meta.tenantId!, meta.agentId!, p)))
              .then((rs) => { fillers = rs.filter((x): x is Buffer => !!x); log(`fillers ready: ${fillers.length}/${FILLER_PHRASES.length}`); })
              .catch(() => {});
          }
        } else {
          log('WARN: no agent/tenant in stream parameters — cannot drive the brain');
        }
        return;
      }

      if (msg.event === 'media') {
        frames++;
        if (handedOff) return;
        const b64 = msg.media?.payload; if (!b64) return;
        const pcm = muLawToPcm16(Buffer.from(b64, 'base64'));
        const energy = pcm16Energy(pcm);
        if (playing) return;

        if (!speaking) {
          idleSamples.push(energy);
          if (idleSamples.length >= 250) {
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
        log('STOP call:', callSid, 'frames:', frames);
        return;
      }
    });

    ws.on('close', () => { playback?.cancel(); log('closed — frames:', frames); });
    ws.on('error', (e) => log('ws error:', (e as Error).message));
  });

  log('Twilio media WS attached at', path);
  return wss;
}
