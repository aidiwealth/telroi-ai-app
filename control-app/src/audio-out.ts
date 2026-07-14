// control-app/src/audio-out.ts
// Turn TTS audio (any format/rate the brain returns) into the raw mu-law 8kHz
// Telnyx wants, using sox — the same tool ai-call.ts already relies on, so no
// hand-rolled resampling. Handles WAV, raw L16 (ElevenLabs), mp3, etc.
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

const TMP = '/tmp/telroi-telnyx';

function pexec(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args);
    let err = '';
    p.stderr.on('data', (d) => { err += d.toString(); });
    p.on('close', (code) => code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}: ${err.slice(0, 200)}`)));
    p.on('error', reject);
  });
}

/**
 * Convert base64 TTS audio to raw mu-law 8kHz mono bytes for Telnyx playback.
 * contentType tells us if it's headerless PCM (needs rate/encoding hints) or a
 * self-describing container sox can sniff.
 */
export async function ttsToMuLaw(b64: string, contentType: string): Promise<Buffer | null> {
  const id = randomUUID();
  const inPath = `${TMP}/${id}.in`;
  const outPath = `${TMP}/${id}.ul`;
  try {
    await fs.mkdir(TMP, { recursive: true });
    await fs.writeFile(inPath, Buffer.from(b64, 'base64'));
    if (/l16|pcm/i.test(contentType)) {
      const rate = /rate=(\d+)/.exec(contentType)?.[1] || '16000';
      await pexec('sox', ['-t', 'raw', '-r', rate, '-e', 'signed', '-b', '16', '-c', '1', inPath,
                          '-r', '8000', '-c', '1', '-e', 'mu-law', '-t', 'raw', outPath]);
    } else {
      await pexec('sox', [inPath, '-r', '8000', '-c', '1', '-e', 'mu-law', '-t', 'raw', outPath]);
    }
    return await fs.readFile(outPath);
  } catch (e) {
    console.log(new Date().toISOString(), '[audio-out] convert failed:', (e as Error).message);
    return null;
  } finally {
    fs.unlink(inPath).catch(() => {});
    fs.unlink(outPath).catch(() => {});
  }
}

/**
 * Stream raw mu-law bytes to Telnyx as 20ms frames, paced in real time.
 * Telnyx expects ~50 frames/sec; sending faster overruns, slower sounds choppy.
 * Uses a drift-corrected schedule so long utterances don't slowly fall behind.
 * Returns a cancel() so a new turn (barge-in) can stop playback mid-stream.
 */
export function streamMuLaw(
  mu: Buffer,
  send: (b64: string) => void,
  onDone?: () => void
): { cancel: () => void } {
  const FRAME = 160;          // bytes = 20ms at 8kHz mu-law
  const INTERVAL = 20;        // ms
  let offset = 0;
  let cancelled = false;
  const startedAt = Date.now();
  let framesSent = 0;

  const tick = () => {
    if (cancelled) return;
    // Send every frame that should have gone out by now (drift correction).
    const due = Math.floor((Date.now() - startedAt) / INTERVAL) + 1;
    while (framesSent < due && offset < mu.length) {
      const chunk = mu.subarray(offset, Math.min(offset + FRAME, mu.length));
      send(chunk.toString('base64'));
      offset += FRAME;
      framesSent++;
    }
    if (offset >= mu.length) { onDone?.(); return; }
    setTimeout(tick, INTERVAL);
  };
  setTimeout(tick, 0);

  return { cancel: () => { cancelled = true; } };
}
