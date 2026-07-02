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
    case 'google': return 'gemini-2.0-flash';
    case 'grok': return 'grok-2-latest';
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

export async function sttTranscribe(tenantId: string, sttConnId: string | null, audio: Buffer, contentType = 'audio/wav', allowManaged = false): Promise<string> {
  const conn = await resolveConn(tenantId, sttConnId, ['deepgram', 'openai', 'google']);
  try {
    if (conn?.provider === 'deepgram') {
      const res = await fetch('https://api.deepgram.com/v1/listen?punctuate=true&model=nova-2', {
        method: 'POST', headers: { Authorization: `Token ${conn.apiKey}`, 'Content-Type': contentType }, body: audio
      });
      if (!res.ok) return '';
      const d: any = await res.json();
      return d?.results?.channels?.[0]?.alternatives?.[0]?.transcript || '';
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
      return d?.text || '';
    }
    if (conn?.provider === 'google') {
      const rate = /rate=(\d+)/.exec(contentType)?.[1] || (/l16|pcm/i.test(contentType) ? '16000' : '8000');
      const res = await fetch(`https://speech.googleapis.com/v1/speech:recognize?key=${conn.apiKey}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          config: { encoding: 'LINEAR16', sampleRateHertz: Number(rate), languageCode: (conn.meta.language as string) || 'en-US' },
          audio: { content: audio.toString('base64') }
        })
      });
      if (!res.ok) return '';
      const d: any = await res.json();
      return d?.results?.map((r: any) => r.alternatives?.[0]?.transcript || '').join(' ').trim() || '';
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
  const conn = await resolveConn(tenantId, ttsConnId, ['elevenlabs', 'openai', 'google']);
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
    if (conn?.provider === 'google') {
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
    sttConnId: pick(['deepgram', 'openai', 'google']),
    ttsConnId: pick(['elevenlabs', 'openai', 'google'])
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

export async function llmReplyWithUsage(llm: ResolvedLlm, systemPrompt: string, history: ChatMessage[]): Promise<{ text: string | null; inputTokens: number; outputTokens: number }> {
  const sys = systemPrompt || 'You are a helpful phone assistant. Keep replies short, natural, and spoken-friendly.';
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
          generationConfig: { maxOutputTokens: 300 }
        })
      });
      if (!res.ok) return { text: null, inputTokens: 0, outputTokens: 0 };
      const d: any = await res.json();
      const text = d.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join(' ') || '';
      return { text: (text || '').trim() || null, inputTokens: d.usageMetadata?.promptTokenCount || 0, outputTokens: d.usageMetadata?.candidatesTokenCount || 0 };
    }
    const chatBase = llm.provider === 'grok' ? 'https://api.x.ai/v1' : 'https://api.openai.com/v1';
    const res = await fetch(`${chatBase}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${llm.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: llm.model, max_tokens: 300, messages: [{ role: 'system', content: sys }, ...history.map((m) => ({ role: m.role, content: m.content }))] })
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
  const stt = role(okConn(agent.sttConnId, ['deepgram', 'openai', 'google']), hasManagedSpeech);
  const tts = role(okConn(agent.ttsConnId, ['elevenlabs', 'openai', 'google']), hasManagedSpeech);
  return { llm, stt, tts, anyManaged: [llm, stt, tts].includes('managed') };
}
