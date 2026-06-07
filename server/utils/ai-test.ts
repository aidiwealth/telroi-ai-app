// server/utils/ai-test.ts
// Minimal authenticated pings to validate a customer's own AI provider key.
// These do the cheapest possible call that proves the key works.

type Provider = 'openai' | 'anthropic' | 'deepgram' | 'elevenlabs' | 'vapi' | 'google';

export async function testAiKey(provider: Provider, apiKey: string, meta: Record<string, any> = {}): Promise<{ ok: boolean; detail?: string }> {
  try {
    switch (provider) {
      case 'openai': {
        const r = await fetch('https://api.openai.com/v1/models', { headers: { Authorization: `Bearer ${apiKey}` } });
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
      case 'vapi': {
        const r = await fetch('https://api.vapi.ai/assistant', { headers: { Authorization: `Bearer ${apiKey}` } });
        return { ok: r.ok, detail: r.ok ? undefined : `HTTP ${r.status}` };
      }
      case 'google': {
        // Google Cloud key validation varies by service; do a lightweight check.
        const r = await fetch(`https://speech.googleapis.com/v1/operations?key=${encodeURIComponent(apiKey)}`);
        return { ok: r.ok, detail: r.ok ? undefined : `HTTP ${r.status}` };
      }
      default:
        return { ok: false, detail: 'Unknown provider' };
    }
  } catch (e: any) {
    return { ok: false, detail: e?.message || 'Network error' };
  }
}
