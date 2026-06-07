// server/utils/voice/telroi-speech.ts
// The 'telroi' TTS/STT path: use Telroi's own speech capability on its voice
// infra. Control-plane here; synthesis/transcription runs on the live engine.
// If Telroi's own speech engine isn't wired to a running backend, this returns
// a clear "not configured" rather than a fake result — so operators know to
// either stand up the engine or pick an external vendor in Settings.
import type { TtsInput, TtsResult, SttInput, SttResult } from './vendors';
import { useRuntimeConfig } from '#imports';

function engineBase(): string | null {
  const c = useRuntimeConfig() as any;
  return (c.telroiSpeechUrl as string) || null; // TELROI_SPEECH_URL when self-hosting an engine
}

export async function telroiTts(input: TtsInput): Promise<TtsResult> {
  const base = engineBase();
  if (!base) return { ok: false, reason: 'Telroi speech engine not configured (set TELROI_SPEECH_URL or choose an external TTS vendor).' };
  try {
    const res = await fetch(`${base}/tts`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
    if (!res.ok) return { ok: false, reason: `Telroi TTS engine error ${res.status}` };
    const d: any = await res.json();
    return { ok: true, resultUrl: d.url, durationMs: d.durationMs };
  } catch (e: any) { return { ok: false, reason: e?.message || 'Telroi TTS error' }; }
}

export async function telroiStt(input: SttInput): Promise<SttResult> {
  const base = engineBase();
  if (!base) return { ok: false, reason: 'Telroi speech engine not configured (set TELROI_SPEECH_URL or choose an external STT vendor).' };
  try {
    const res = await fetch(`${base}/stt`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
    if (!res.ok) return { ok: false, reason: `Telroi STT engine error ${res.status}` };
    const d: any = await res.json();
    return { ok: true, transcript: d.transcript, durationMs: d.durationMs };
  } catch (e: any) { return { ok: false, reason: e?.message || 'Telroi STT error' }; }
}
