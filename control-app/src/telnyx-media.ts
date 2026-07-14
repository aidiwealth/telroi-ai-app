// control-app/src/telnyx-media.ts
// ───────────────────────────────────────────────────────────────────────────
// Telnyx AI media adapter — the WebSocket endpoint Telnyx forks call audio to.
// Telnyx connects here (via streaming_start), then sends JSON frames:
//   { event:'connected' }              once on connect
//   { event:'start', start:{...} }     stream metadata (call_control_id, etc.)
//   { event:'media', media:{ payload } } base64 PCMU (mu-law 8kHz) audio, ~20ms
//   { event:'stop' }                   stream ended
// We answer back on the SAME socket with { event:'media', media:{ payload } }.
//
// STAGE 1: prove the pipe. We just log lifecycle + a periodic media heartbeat.
// Audio decode / STT / turn loop / playback come in later stages.
// ───────────────────────────────────────────────────────────────────────────
import { WebSocketServer, type WebSocket } from 'ws';
import type http from 'node:http';

function log(...args: unknown[]) {
  console.log(new Date().toISOString(), '[telnyx-media]', ...args);
}

interface StreamState {
  callControlId: string | null;
  mediaFrames: number;
  startedAt: number;
}

export function attachTelnyxMedia(server: http.Server, path = '/telnyx-media') {
  // noServer so we can gate the upgrade to our path and share the HTTP server.
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    let url = '';
    try { url = new URL(req.url || '', 'http://127.0.0.1').pathname; } catch { url = req.url || ''; }
    if (url !== path) return; // let other upgrade handlers (if any) deal with it
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  wss.on('connection', (ws: WebSocket) => {
    const st: StreamState = { callControlId: null, mediaFrames: 0, startedAt: Date.now() };
    log('connection opened');

    ws.on('message', (data: Buffer) => {
      let msg: any;
      try { msg = JSON.parse(data.toString()); } catch { return; }
      switch (msg.event) {
        case 'connected':
          log('connected event, version:', msg.version || '?');
          break;
        case 'start':
          st.callControlId = msg.start?.call_control_id || msg.start?.callControlId || null;
          log('stream START — call:', st.callControlId, 'media_format:', JSON.stringify(msg.start?.media_format || {}));
          break;
        case 'media':
          st.mediaFrames++;
          // Heartbeat every ~100 frames (~2s at 20ms/frame) so logs aren't flooded.
          if (st.mediaFrames === 1 || st.mediaFrames % 100 === 0) {
            const payloadLen = (msg.media?.payload || '').length;
            log('media frames:', st.mediaFrames, 'last payload b64 len:', payloadLen);
          }
          break;
        case 'stop':
          log('stream STOP — call:', st.callControlId, 'total media frames:', st.mediaFrames, 'dur(ms):', Date.now() - st.startedAt);
          break;
        default:
          log('other event:', msg.event);
      }
    });

    ws.on('close', () => log('connection closed — frames:', st.mediaFrames));
    ws.on('error', (e) => log('ws error:', (e as Error).message));
  });

  log('Telnyx media WS attached at', path);
  return wss;
}
