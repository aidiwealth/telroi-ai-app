// server/utils/ai-test.ts
// Minimal provider requests to validate a customer's own AI connection.
// LLM providers receive a short chat prompt so the test proves chat works.

import { openAiTokenLimitField, resolveOpenAiBaseUrl } from './openai-base-url';

type Provider = 'openai' | 'anthropic' | 'deepgram' | 'elevenlabs' | 'google' | 'google-cloud' | 'grok';

export async function testAiKey(provider: Provider, apiKey: string, meta: Record<string, any> = {}): Promise<{ ok: boolean; detail?: string }> {
  try {
    switch (provider) {
      case 'openai': {
        const baseUrl = resolveOpenAiBaseUrl(meta?.baseUrl);
        const model = String(meta?.model || '').trim() || 'gpt-4o-mini';
        const r = await fetch(`${baseUrl}/chat/completions`, {
          redirect: 'error',
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model,
            [openAiTokenLimitField(baseUrl)]: 300,
            messages: [{ role: 'user', content: 'Reply with only: ok' }]
          })
        });
        return await checkChatResponse(r, (body) => body?.choices?.[0]?.message?.content);
      }
      case 'grok': {
        const r = await fetch('https://api.x.ai/v1/chat/completions', {
          redirect: 'error',
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: String(meta?.model || '').trim() || 'grok-4.3',
            max_tokens: 1500,
            reasoning_effort: 'none',
            messages: [{ role: 'user', content: 'Reply with only: ok' }]
          })
        });
        return await checkChatResponse(r, (body) => body?.choices?.[0]?.message?.content);
      }
      case 'anthropic': {
        const r = await fetch('https://api.anthropic.com/v1/messages', {
          redirect: 'error',
          method: 'POST',
          headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: String(meta?.model || '').trim() || 'claude-haiku-4-5-20251001',
            max_tokens: 300,
            messages: [{ role: 'user', content: 'Reply with only: ok' }]
          })
        });
        return await checkChatResponse(r, (body) => body?.content?.filter((part: any) => part.type === 'text').map((part: any) => part.text).join(' '));
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
        const model = String(meta?.model || '').trim() || 'gemini-2.5-flash';
        const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
          redirect: 'error',
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: 'Reply with only: ok' }] }],
            generationConfig: { maxOutputTokens: 800, thinkingConfig: { thinkingBudget: 0 } }
          })
        });
        return await checkChatResponse(r, (body) => body?.candidates?.[0]?.content?.parts?.map((part: any) => part.text).join(' '));
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
  } catch {
    // Do not return fetch error strings: for Google they can include the API key
    // because that provider accepts credentials in the URL query string.
    return { ok: false, detail: 'Network error' };
  }
}

async function checkChatResponse(response: Response, getText: (body: any) => unknown): Promise<{ ok: boolean; detail?: string }> {
  if (!response.ok) return { ok: false, detail: `HTTP ${response.status}` };
  let body: any;
  try { body = await response.json(); }
  catch { return { ok: false, detail: 'Invalid response from provider' }; }

  const text = String(getText(body) || '').trim();
  const normalized = text.toLowerCase().replace(/^[\s"'`]+|[\s"'`.,!?]+$/g, '');
  return normalized === 'ok'
    ? { ok: true }
    : { ok: false, detail: text ? 'The model did not return the expected "ok" response' : 'The model returned no text' };
}
