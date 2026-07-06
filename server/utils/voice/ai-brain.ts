// server/utils/voice/ai-brain.ts
// The LLM half of the AI voice agent. Two responsibilities:
//   1. Resolve which LLM credentials to use for a turn — BYOK (the tenant's own
//      key via ai_connections) or the Telroi-managed default (platform env key +
//      a cheap model). BYOK carries zero LLM cost for us; managed is the
//      low-cost fallback for clients who don't bring a key.
//   2. Run a chat completion (system prompt + conversation history -> reply).
import { and, eq } from 'drizzle-orm';
import { useDb, schema } from '../../db';
import { decrypt } from '../crypto';
import { useRuntimeConfig } from '#imports';

export type LlmProvider = 'anthropic' | 'openai' | 'google' | 'grok';

export interface ResolvedLlm {
  provider: LlmProvider;
  apiKey: string;
  model: string;
  managed: boolean;
}

export interface ChatMessage { role: 'user' | 'assistant'; content: string; }

function managedDefaults(): { provider: LlmProvider; model: string; apiKey: string } | null {
  const c = useRuntimeConfig() as any;
  const provider = (c.managedLlmProvider as LlmProvider) || 'anthropic';
  if (provider === 'openai') {
    const apiKey = (c.managedOpenaiKey as string) || (c.openaiApiKey as string) || '';
    if (!apiKey) return null;
    return { provider, model: (c.managedLlmModel as string) || 'gpt-4o-mini', apiKey };
  }
  const apiKey = (c.managedAnthropicKey as string) || (c.anthropicApiKey as string) || '';
  if (!apiKey) return null;
  return { provider: 'anthropic', model: (c.managedLlmModel as string) || 'claude-haiku-4-5-20251001', apiKey };
}

export async function resolveAgentLlm(tenantId: string, llmConnId: string | null, allowManaged = false): Promise<ResolvedLlm | null> {
  if (llmConnId) {
    const [conn] = await useDb().select().from(schema.aiConnections)
      .where(and(eq(schema.aiConnections.id, llmConnId), eq(schema.aiConnections.tenantId, tenantId))).limit(1);
    if (conn && (conn.provider === 'anthropic' || conn.provider === 'openai' || conn.provider === 'google' || conn.provider === 'grok')) {
      try {
        const apiKey = decrypt(conn.apiKeyEnc);
        const meta = (conn.meta || {}) as Record<string, any>;
        const model = (meta.model as string) || defaultModelFor(conn.provider as LlmProvider);
        return { provider: conn.provider as LlmProvider, apiKey, model, managed: false };
      } catch { /* fall through to managed */ }
    }
  }
  if (!allowManaged) return null;
  const m = managedDefaults();
  if (m) return { provider: m.provider, apiKey: m.apiKey, model: m.model, managed: true };
  return null;
}

function defaultModelFor(p: LlmProvider): string {
  switch (p) {
    case 'openai': return 'gpt-4o-mini';
    case 'google': return 'gemini-2.5-flash';
    case 'grok': return 'grok-4.3';
    default: return 'claude-haiku-4-5-20251001';
  }
}

export async function llmReply(llm: ResolvedLlm, systemPrompt: string, history: ChatMessage[]): Promise<string | null> {
  // Thin wrapper so there is ONE LLM code path covering anthropic/openai/google/grok.
  const r = await llmReplyWithUsage(llm, systemPrompt, history);
  return r.text;
}

// ── STT / TTS for the turn loop ─────────────────────────────────────────────
export interface ResolvedSpeech { provider: string; apiKey: string; managed: boolean; meta: Record<string, any>; }

async function resolveConn(tenantId: string, connId: string | null, kinds: string[]): Promise<ResolvedSpeech | null> {
  if (connId) {
    const [conn] = await useDb().select().from(schema.aiConnections)
      .where(and(eq(schema.aiConnections.id, connId), eq(schema.aiConnections.tenantId, tenantId))).limit(1);
    if (conn && kinds.includes(conn.provider)) {
      try { return { provider: conn.provider, apiKey: decrypt(conn.apiKeyEnc), managed: false, meta: (conn.meta || {}) as any }; }
      catch (e) { console.error(`[ai-brain] resolveConn decrypt failed for ${conn.provider}: ${(e as Error)?.message}`); }
    } else if (!conn) {
      console.error(`[ai-brain] resolveConn: no connection ${connId} for tenant ${tenantId}`);
    } else {
      console.error(`[ai-brain] resolveConn: provider ${conn.provider} not in [${kinds.join(',')}]`);
    }
  }
  return null;
}

// Google/Deepgram STT hallucinate on near-silence or noise, emitting phantom text:
// single filler words ("you", "thank you", "bye"), repeated fragments, or text in
// an unexpected language/script (e.g. Korean/Chinese on an English agent). Treat
// these as EMPTY so the agent nudges ("didn't catch that") instead of replying to
// garbage. This is conservative: it only rejects the well-known junk patterns.
function isLikelyHallucination(text: string, expectedLang: string): boolean {
  const t = (text || '').trim();
  if (!t) return true;
  const lower = t.toLowerCase().replace(/[.,!?]/g, '').trim();
  // Common single-word/short filler hallucinations on silence.
  const junk = new Set(['you', 'thank you', 'thanks', 'bye', 'okay', 'ok', 'uh', 'um', 'hmm', 'yeah', 'the', 'a', 'so', 'hello', 'hi', 'you you', 'you you you']);
  if (junk.has(lower)) return true;
  // Repeated single token (e.g. "you you you you").
  const words = lower.split(/\s+/);
  if (words.length >= 2 && new Set(words).size === 1) return true;
  // Script/language mismatch: if the agent expects a Latin-script language (en/es/
  // fr/pt etc.) but the transcript is largely CJK/Hangul/Cyrillic/Arabic, it's almost
  // certainly a silence hallucination.
  const expectsLatin = /^(en|es|fr|pt|de|it|nl|sv|no|da|fi|pl)/i.test(expectedLang || 'en');
  if (expectsLatin) {
    const nonLatin = (t.match(/[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af\u0400-\u04ff\u0600-\u06ff]/g) || []).length;
    if (nonLatin > 0 && nonLatin >= t.replace(/\s/g, '').length * 0.3) return true;
  }
  return false;
}

export async function sttTranscribe(tenantId: string, sttConnId: string | null, audio: Buffer, contentType = 'audio/wav', allowManaged = false): Promise<string> {
  const conn = await resolveConn(tenantId, sttConnId, ['deepgram', 'openai', 'google-cloud']);
  try {
    if (conn?.provider === 'deepgram') {
      const res = await fetch('https://api.deepgram.com/v1/listen?punctuate=true&model=nova-2', {
        method: 'POST', headers: { Authorization: `Token ${conn.apiKey}`, 'Content-Type': contentType }, body: audio
      });
      if (!res.ok) return '';
      const d: any = await res.json();
      const dgTx = (d?.results?.channels?.[0]?.alternatives?.[0]?.transcript || '').trim();
      const dgLang = (conn.meta.language as string) || 'en-US';
      if (isLikelyHallucination(dgTx, dgLang)) { console.log(`[ai-brain] STT(deepgram) rejected likely hallucination: "${dgTx.slice(0,80)}"`); return ''; }
      return dgTx;
    }
    if (conn?.provider === 'openai') {
      const form = new FormData();
      form.append('file', new Blob([audio], { type: contentType }), 'turn.wav');
      form.append('model', 'whisper-1');
      const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST', headers: { Authorization: `Bearer ${conn.apiKey}` }, body: form as any
      });
      if (!res.ok) return '';
      const d: any = await res.json();
      const oaiTx = (d?.text || '').trim();
      const oaiLang = (conn.meta.language as string) || 'en-US';
      if (isLikelyHallucination(oaiTx, oaiLang)) { console.log(`[ai-brain] STT(openai) rejected likely hallucination: "${oaiTx.slice(0,80)}"`); return ''; }
      return oaiTx;
    }
    if (conn?.provider === 'google-cloud') {
      // The audio is a WAV FILE (RIFF header + PCM). Do NOT force encoding=LINEAR16
      // with a manual rate — that tells Google the bytes are raw headerless PCM, so
      // it misreads the 44-byte WAV header as audio and garbles the transcript.
      // Detect raw PCM vs a real WAV: only set explicit encoding/rate for raw PCM.
      const isRawPcm = /l16|pcm/i.test(contentType) && !/wav/i.test(contentType);
      const cfg: any = {
        languageCode: (conn.meta.language as string) || 'en-US',
        model: 'phone_call',          // tuned for 8kHz telephony audio (keeps accuracy)
        enableAutomaticPunctuation: true
      };
      if (isRawPcm) {
        cfg.encoding = 'LINEAR16';
        cfg.sampleRateHertz = Number(/rate=(\d+)/.exec(contentType)?.[1] || '16000');
      }
      // For a WAV file, omit encoding/sampleRateHertz — Google reads them from the header.
      const res = await fetch(`https://speech.googleapis.com/v1/speech:recognize?key=${conn.apiKey}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: cfg, audio: { content: audio.toString('base64') } })
      });
      if (!res.ok) {
        const body = (await res.text().catch(()=>'')).slice(0,300);
        console.error(`[ai-brain] Google STT failed ${res.status}: ${body}`);
        // 'phone_call' model isn't available in every region/project — retry without it.
        if (/model/i.test(body)) {
          delete cfg.model; delete cfg.useEnhanced;
          const r2 = await fetch(`https://speech.googleapis.com/v1/speech:recognize?key=${conn.apiKey}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ config: cfg, audio: { content: audio.toString('base64') } })
          });
          if (r2.ok) { const d2: any = await r2.json(); const t2 = d2?.results?.map((r: any) => r.alternatives?.[0]?.transcript || '').join(' ').trim() || ''; console.log(`[ai-brain] STT(google,fallback) got ${t2.length} chars: "${t2.slice(0,80)}"`); return t2; }
        }
        return '';
      }
      const d: any = await res.json();
      const tx = d?.results?.map((r: any) => r.alternatives?.[0]?.transcript || '').join(' ').trim() || '';
      console.log(`[ai-brain] STT(google) got ${tx.length} chars: "${tx.slice(0,80)}"`);
      return tx;
    }
    if (!allowManaged) return '';
    const c = useRuntimeConfig() as any;
    const base = c.telroiSpeechUrl as string;
    if (base) {
      const res = await fetch(`${base}/stt`, { method: 'POST', headers: { 'Content-Type': contentType }, body: audio });
      if (res.ok) { const d: any = await res.json(); return d?.transcript || ''; }
    }
    const managedKey = (c.managedOpenaiKey as string) || (c.openaiApiKey as string) || '';
    if (managedKey) {
      const form = new FormData();
      form.append('file', new Blob([audio], { type: contentType }), 'turn.wav');
      form.append('model', 'whisper-1');
      const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST', headers: { Authorization: `Bearer ${managedKey}` }, body: form as any
      });
      if (res.ok) { const d: any = await res.json(); return d?.text || ''; }
      console.error(`[ai-brain] managed STT (OpenAI) failed ${res.status}`);
    }
    return '';
  } catch { return ''; }
}

export async function ttsSynthesize(tenantId: string, ttsConnId: string | null, text: string, opts: { voice?: string } = {}, allowManaged = false): Promise<{ audio: Buffer; contentType: string } | null> {
  const conn = await resolveConn(tenantId, ttsConnId, ['elevenlabs', 'openai', 'google-cloud']);
  try {
    if (conn?.provider === 'elevenlabs') {
      const voiceId = opts.voice || (conn.meta.defaultVoice as string) || '21m00Tcm4TlvDq8ikWAM';
      const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=pcm_16000`, {
        method: 'POST', headers: { 'xi-api-key': conn.apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, model_id: (conn.meta.model as string) || 'eleven_multilingual_v2' })
      });
      if (!res.ok) return null;
      return { audio: Buffer.from(await res.arrayBuffer()), contentType: 'audio/l16; rate=16000' };
    }
    if (conn?.provider === 'openai') {
      const res = await fetch('https://api.openai.com/v1/audio/speech', {
        method: 'POST', headers: { Authorization: `Bearer ${conn.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: (conn.meta.model as string) || 'tts-1', voice: opts.voice || 'alloy', input: text, response_format: 'wav' })
      });
      if (!res.ok) return null;
      return { audio: Buffer.from(await res.arrayBuffer()), contentType: 'audio/wav' };
    }
    if (conn?.provider === 'google-cloud') {
      const voice = opts.voice || (conn.meta.defaultVoice as string) || 'en-US-Neural2-C';
      const lang = (conn.meta.language as string) || voice.split('-').slice(0, 2).join('-') || 'en-US';
      const res = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${conn.apiKey}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: { text }, voice: { languageCode: lang, name: voice }, audioConfig: { audioEncoding: 'LINEAR16', sampleRateHertz: 16000 } })
      });
      if (!res.ok) { console.error(`[ai-brain] Google TTS failed ${res.status}`); return null; }
      const d: any = await res.json();
      if (!d?.audioContent) return null;
      return { audio: Buffer.from(d.audioContent, 'base64'), contentType: 'audio/wav' };
    }
    if (!allowManaged) return null;
    const c = useRuntimeConfig() as any;
    const base = c.telroiSpeechUrl as string;
    if (base) {
      const res = await fetch(`${base}/tts`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, voice: opts.voice }) });
      if (res.ok) return { audio: Buffer.from(await res.arrayBuffer()), contentType: res.headers.get('content-type') || 'audio/wav' };
    }
    const mk = (c.managedOpenaiKey as string) || (c.openaiApiKey as string) || '';
    if (mk) {
      const res = await fetch('https://api.openai.com/v1/audio/speech', {
        method: 'POST', headers: { Authorization: `Bearer ${mk}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'tts-1', voice: opts.voice || 'alloy', input: text, response_format: 'wav' })
      });
      if (res.ok) return { audio: Buffer.from(await res.arrayBuffer()), contentType: 'audio/wav' };
    }
    return null;
  } catch { return null; }
}

// ── Auto-assign default connections for an agent ────────────────────────────
export interface DefaultConns { sttConnId: string | null; llmConnId: string | null; ttsConnId: string | null; }

export async function resolveDefaultConnections(tenantId: string): Promise<DefaultConns> {
  const rows = await useDb().select().from(schema.aiConnections)
    .where(eq(schema.aiConnections.tenantId, tenantId));
  const usable = rows.filter((r) => r.status === 'ok');
  const pool = usable.length ? usable : rows;
  const pick = (prefs: string[]): string | null => {
    for (const p of prefs) { const c = pool.find((r) => r.provider === p); if (c) return c.id; }
    return null;
  };
  return {
    llmConnId: pick(['anthropic', 'openai', 'google', 'grok']),
    sttConnId: pick(['deepgram', 'openai', 'google-cloud']),
    ttsConnId: pick(['elevenlabs', 'openai', 'google-cloud'])
  };
}

// ── Managed-tier cost model + usage recording ───────────────────────────────
export interface TurnUsage { sttSeconds: number; llmInputTokens: number; llmOutputTokens: number; ttsChars: number; }

export async function managedCostMinorUsd(u: TurnUsage): Promise<number> {
  const c = useRuntimeConfig() as any;
  const num = (v: any, def: number): number => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : def; };
  let sttPerSec = num(c.costSttPerSec, 0.0001);
  let llmInPerTok = num(c.costLlmInPerTok, 0.0000008);
  let llmOutPerTok = num(c.costLlmOutPerTok, 0.000004);
  let ttsPerChar = num(c.costTtsPerChar, 0.000015);
  let markupPct = 0;
  try {
    const [p] = await useDb().select().from(schema.pricing).where(eq(schema.pricing.id, 'singleton')).limit(1);
    if (p) {
      if (p.aiSttPerSecNano != null) sttPerSec = p.aiSttPerSecNano / 1e9;
      if (p.aiLlmInPerTokNano != null) llmInPerTok = p.aiLlmInPerTokNano / 1e9;
      if (p.aiLlmOutPerTokNano != null) llmOutPerTok = p.aiLlmOutPerTokNano / 1e9;
      if (p.aiTtsPerCharNano != null) ttsPerChar = p.aiTtsPerCharNano / 1e9;
      if (p.aiMarkupPct != null) markupPct = p.aiMarkupPct;
    }
  } catch { /* no pricing row -> env/defaults */ }
  let usd = u.sttSeconds * sttPerSec + u.llmInputTokens * llmInPerTok + u.llmOutputTokens * llmOutPerTok + u.ttsChars * ttsPerChar;
  if (markupPct > 0) usd = usd * (1 + markupPct / 100);
  return Math.max(0, Math.round(usd * 100));
}

export async function recordAiUsage(args: {
  tenantId: string; agentId: string | null; callId: string | null; managed: boolean; usage: TurnUsage;
}): Promise<void> {
  try {
    const cost = args.managed ? await managedCostMinorUsd(args.usage) : 0;
    await useDb().insert(schema.aiUsage).values({
      tenantId: args.tenantId, agentId: args.agentId || undefined, callId: args.callId || undefined,
      managed: args.managed, sttSeconds: Math.round(args.usage.sttSeconds),
      llmInputTokens: args.usage.llmInputTokens, llmOutputTokens: args.usage.llmOutputTokens,
      ttsChars: args.usage.ttsChars, costMinorUsd: cost
    });
  } catch { /* usage tracking must never break a call */ }
}

// Wraps a client's system prompt with scope discipline so the AI stays on the
// company's domain and politely declines/deflects off-topic requests (general
// knowledge, coding, math, other companies, world facts, etc.) rather than acting
// as a general assistant. Kept spoken-friendly and brief. If the client supplied
// no prompt at all we fall back to a neutral receptionist persona.
export function applyScopeGating(systemPrompt: string): string {
  const base = (systemPrompt || '').trim();
  if (!base) {
    return 'You are a warm, helpful phone receptionist for this business. Answer callers naturally and conversationally, help them with whatever they need related to the business, and keep replies short and spoken-friendly.';
  }
  // Minimal, non-intrusive nudge: keep the client's persona fully intact and just
  // add one gentle line. We do NOT add heavy guardrails that make the agent refuse
  // or deflect — the client's own prompt defines the domain; over-restricting hurts
  // the core experience. Only clearly-unrelated asks should be softly redirected.
  return `${base}

(If a caller asks something with clearly no connection to this business — like general trivia, math, or coding — gently steer back to how you can help them with the business. Otherwise, always engage naturally and helpfully. Keep replies short and spoken-friendly.)`;
}

export async function llmReplyWithUsage(llm: ResolvedLlm, systemPrompt: string, history: ChatMessage[]): Promise<{ text: string | null; inputTokens: number; outputTokens: number }> {
  const sys = applyScopeGating(systemPrompt);
  try {
    if (llm.provider === 'anthropic') {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': llm.apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: llm.model, max_tokens: 300, system: sys, messages: history.map((m) => ({ role: m.role, content: m.content })) })
      });
      if (!res.ok) return { text: null, inputTokens: 0, outputTokens: 0 };
      const d: any = await res.json();
      const text = Array.isArray(d.content) ? d.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join(' ') : '';
      return { text: (text || '').trim() || null, inputTokens: d.usage?.input_tokens || 0, outputTokens: d.usage?.output_tokens || 0 };
    }
    if (llm.provider === 'google') {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${llm.model}:generateContent?key=${llm.apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: sys }] },
          contents: history.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
          // Gemini 2.5 is a thinking model: it spends output tokens on hidden
          // reasoning first, so a small budget can leave NO visible reply (empty
          // text -> the turn treats it as a failure and cuts off). Disable thinking
          // and give ample headroom so there's always a spoken answer.
          generationConfig: { maxOutputTokens: 800, thinkingConfig: { thinkingBudget: 0 } }
        })
      });
      if (!res.ok) { console.error(`[ai-brain] Gemini LLM failed ${res.status}: ${(await res.text().catch(()=>'')).slice(0,200)}`); return { text: null, inputTokens: 0, outputTokens: 0 }; }
      const d: any = await res.json();
      const text = d.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join(' ') || '';
      if (!text.trim()) console.error(`[ai-brain] Gemini empty reply — finishReason=${d.candidates?.[0]?.finishReason || '?'}`);
      return { text: (text || '').trim() || null, inputTokens: d.usageMetadata?.promptTokenCount || 0, outputTokens: d.usageMetadata?.candidatesTokenCount || 0 };
    }
    const isGrok = llm.provider === 'grok';
    const chatBase = isGrok ? 'https://api.x.ai/v1' : 'https://api.openai.com/v1';
    // Grok 4.x is reasoning-first: it spends output tokens on hidden reasoning
    // before the visible reply, so a low max_tokens can leave nothing to say.
    // Give it headroom and request no reasoning effort (best-effort — ignored by
    // models that force reasoning, but the higher budget still covers us).
    const chatBody: any = {
      model: llm.model,
      max_tokens: isGrok ? 1500 : 300,
      messages: [{ role: 'system', content: sys }, ...history.map((m) => ({ role: m.role, content: m.content }))]
    };
    if (isGrok) chatBody.reasoning_effort = 'none';
    const res = await fetch(`${chatBase}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${llm.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(chatBody)
    });
    if (!res.ok) return { text: null, inputTokens: 0, outputTokens: 0 };
    const d: any = await res.json();
    return { text: (d.choices?.[0]?.message?.content || '').trim() || null, inputTokens: d.usage?.prompt_tokens || 0, outputTokens: d.usage?.completion_tokens || 0 };
  } catch {
    return { text: null, inputTokens: 0, outputTokens: 0 };
  }
}

// ── Tier visibility ─────────────────────────────────────────────────────────
export interface AgentTier { llm: 'byok' | 'managed' | 'unavailable'; stt: 'byok' | 'managed' | 'unavailable'; tts: 'byok' | 'managed' | 'unavailable'; anyManaged: boolean; }

export async function resolveAgentTier(tenantId: string, agent: { llmConnId: string | null; sttConnId: string | null; ttsConnId: string | null; tier?: string }): Promise<AgentTier> {
  const conns = await useDb().select().from(schema.aiConnections)
    .where(eq(schema.aiConnections.tenantId, tenantId));
  const okConn = (id: string | null, providers: string[]) =>
    !!id && conns.some((c) => c.id === id && providers.includes(c.provider) && c.status === 'ok');
  const c = useRuntimeConfig() as any;
  const hasManagedLlm = !!((c.managedAnthropicKey as string) || (c.managedOpenaiKey as string) || (c.anthropicApiKey as string) || (c.openaiApiKey as string));
  const hasManagedSpeech = !!((c.managedOpenaiKey as string) || (c.openaiApiKey as string) || (c.telroiSpeechUrl as string));
  const managed = agent.tier === 'managed';
  const role = (byok: boolean, managedAvail: boolean): 'byok' | 'managed' | 'unavailable' => {
    if (managed) return managedAvail ? 'managed' : 'unavailable';
    return byok ? 'byok' : 'unavailable';
  };
  const llm = role(okConn(agent.llmConnId, ['anthropic', 'openai', 'google', 'grok']), hasManagedLlm);
  const stt = role(okConn(agent.sttConnId, ['deepgram', 'openai', 'google-cloud']), hasManagedSpeech);
  const tts = role(okConn(agent.ttsConnId, ['elevenlabs', 'openai', 'google-cloud']), hasManagedSpeech);
  return { llm, stt, tts, anyManaged: [llm, stt, tts].includes('managed') };
}
