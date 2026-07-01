// control-app/src/ai-call.ts
// ── Asterisk media adapter for the AI voice agent (turn-based v1) ──
//
// This is ONE of several possible media adapters. The AI "brain" — STT -> LLM
// -> TTS — lives behind the provider-agnostic web endpoint POST /api/voice/ai/turn
// and is reused unchanged by every telephony provider. This file only handles
// the Asterisk-specific media: recording the caller's turn via ARI and playing
// the reply back. Future Twilio/Telnyx support is a separate adapter that calls
// the SAME /ai/turn brain — no brain changes needed.
import type * as Ari from 'ari-client';
import { promises as fs } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';

const pexec = promisify(execFile);

const WEBAPP_URL = process.env.WEBAPP_URL || 'https://app.telroi.ai';
const INTERNAL_SECRET = process.env.PROVISION_AGENT_SECRET || process.env.TELROI_INTERNAL_SECRET || '';
const RECORD_DIR = process.env.ASTERISK_RECORDING_DIR || '/var/spool/asterisk/recording';
const SOUNDS_TMP = process.env.ASTERISK_SOUNDS_TMP || '/var/lib/asterisk/sounds/telroi-tmp';
const MAX_TURNS = Number(process.env.AI_MAX_TURNS || 20);

interface ChatMessage { role: 'user' | 'assistant'; content: string; }
type Logger = (msg: string) => void;

interface TurnResponse {
  reply: string | null;
  audioBase64: string | null;
  audioContentType: string | null;
  history: ChatMessage[];
  action: 'continue' | 'hangup' | 'transfer';
  transferTo?: string | null;
}

async function callTurn(payload: Record<string, unknown>): Promise<TurnResponse | null> {
  try {
    const res = await fetch(`${WEBAPP_URL}/api/voice/ai/turn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-telroi-internal': INTERNAL_SECRET },
      body: JSON.stringify(payload)
    });
    if (!res.ok) return null;
    return await res.json() as TurnResponse;
  } catch {
    return null;
  }
}

async function prepPlayback(b64: string, contentType: string, log: Logger): Promise<string | null> {
  try {
    await fs.mkdir(SOUNDS_TMP, { recursive: true });
    const id = randomUUID();
    const raw = `${SOUNDS_TMP}/${id}-raw`;
    const out = `${SOUNDS_TMP}/${id}`;
    const buf = Buffer.from(b64, 'base64');
    if (/l16|pcm/i.test(contentType)) {
      const rate = /rate=(\d+)/.exec(contentType)?.[1] || '16000';
      await fs.writeFile(`${raw}.raw`, buf);
      await pexec('sox', ['-t', 'raw', '-r', rate, '-e', 'signed', '-b', '16', '-c', '1', `${raw}.raw`, '-r', '8000', '-c', '1', `${out}.wav`]);
    } else {
      await fs.writeFile(`${raw}.in`, buf);
      await pexec('sox', [`${raw}.in`, '-r', '8000', '-c', '1', `${out}.wav`]);
    }
    return `sound:${out}`;
  } catch (e) {
    log(`ai: prepPlayback failed: ${(e as Error)?.message}`);
    return null;
  }
}

async function playMedia(channel: Ari.Channel, client: Ari.Client, media: string): Promise<void> {
  await new Promise<void>((resolve) => {
    const pb = client.Playback();
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    pb.once('PlaybackFinished', finish);
    channel.play({ media }, pb).catch(() => finish());
    setTimeout(finish, 30000);
  });
}
