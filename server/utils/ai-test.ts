// server/utils/ai-test.ts
// Minimal authenticated pings to validate a customer's own AI provider key.
// These do the cheapest possible call that proves the key works.

type Provider = 'openai' | 'anthropic' | 'deepgram' | 'elevenlabs' | 'google' | 'google-cloud' | 'grok';

export async function testAiKey(provider: Provider, apiKey: string, meta: Record<string, any> = {}): Promise<{ ok: boolean; detail?: string }> {
  try {
    switch (provider) {
      case 'openai': {
        const r = await fetch('https://api.openai.com/v1/models', { headers: { Authorization: `Bearer ${apiKey}` } });
        return { ok: r.ok, detail: r.ok ? undefined : `HTTP ${r.status}` };
      }
      case 'grok': {
        const r = await fetch('https://api.x.ai/v1/models', { headers: { Authorization: `Bearer ${apiKey}` } });
        return { ok: r.ok, detail: r.ok ? undefined : `HTTP ${r.status}` };
      }
      case 'anthropic': {
        // models endpoint requires the version header; 200 proves the key.
        const r = await fetch('https://api.anthropic.com/v1/models', {
          headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }
        });
        return { ok: r.ok, detail: r.ok ? undefined : `HTTP ${r.status}` };
      }
      case 'deepgram': {
        const r = await fetch('https://api.deepgram.com/v1/projects', { headers: { Authorization: `Token ${apiKey}` } });
        return { ok: r.ok, detail: r.ok ? undefined : `HTTP ${r.status}` };
      }
      case 'elevenlabs': {
        const r = await fetch('https://api.elevenlabs.io/v1/user', { headers: { 'xi-api-key': apiKey } });
        return { ok: r.ok, detail: r.ok ? undefined : `HTTP ${r.status}` };
      }
      case 'google': {
        // Gemini (Generative Language API) — the LLM key, NOT Cloud Speech.
        const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`);
        return { ok: r.ok, detail: r.ok ? undefined : `HTTP ${r.status}` };
      }
      case 'google-cloud': {
        // Google Cloud Speech (STT + TTS) — a DIFFERENT credential from Gemini.
        // Validate against the actual endpoint the calls use (Cloud Text-to-Speech),
        // so a green test means real STT/TTS will work — not a Gemini false-positive.
        const r = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(apiKey)}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ input: { text: 'test' }, voice: { languageCode: 'en-US', name: 'en-US-Neural2-C' }, audioConfig: { audioEncoding: 'LINEAR16' } })
        });
        if (r.ok) return { ok: true };
        const body = (await r.text().catch(() => '')).slice(0, 200);
        return { ok: false, detail: `HTTP ${r.status}${body ? ' — ' + body : ''}` };
      }
      default:
        return { ok: false, detail: 'Unknown provider' };
    }
  } catch (e: any) {
    return { ok: false, detail: e?.message || 'Network error' };
  }
}
