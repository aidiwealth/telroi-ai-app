// server/api/voice/ai/turn.post.ts
// Internal endpoint called by the PBX control-app once per conversational turn.
// Stateless: the control-app holds the running history and passes it each turn.
// Auth: shared secret header (x-telroi-internal).
import { eq, and } from 'drizzle-orm';
import { buildKnowledgeContext } from '~/server/utils/knowledge-retrieve';
import { useDb, schema } from '~/server/db';
import { resolveAgentLlm, llmReplyWithUsage, sttTranscribe, ttsSynthesize, recordAiUsage, type ChatMessage } from '~/server/utils/voice/ai-brain';

export default defineEventHandler(async (event) => {
  const cfg = useRuntimeConfig() as any;
  const secret = (cfg.internalSecret as string) || (cfg.provisionAgentSecret as string) || '';
  const given = getHeader(event, 'x-telroi-internal') || '';
  if (!secret || given !== secret) throw createError({ statusCode: 401, statusMessage: 'unauthorized' });

  const body = await readBody(event).catch(() => ({} as any));
  const { agentId, tenantId, first, telnum } = body || {};
  if (!agentId || !tenantId) throw createError({ statusCode: 400, statusMessage: 'agentId and tenantId required' });

  const [agent] = await useDb().select().from(schema.aiAgents)
    .where(and(eq(schema.aiAgents.id, agentId), eq(schema.aiAgents.tenantId, tenantId))).limit(1);
  if (!agent) throw createError({ statusCode: 404, statusMessage: 'agent not found' });

  const history: ChatMessage[] = Array.isArray(body.history) ? body.history : [];

  if (first) {
    const greeting = agent.greeting || 'Hello, thanks for calling. How can I help you today?';
    const tts = await ttsSynthesize(tenantId, agent.ttsConnId, greeting, { language: agent.language }, agent.tier === 'managed');
    return { reply: greeting, audioBase64: tts ? tts.audio.toString('base64') : null, audioContentType: tts?.contentType || null, history: [{ role: 'assistant', content: greeting }], action: 'continue' };
  }

  let userText = '';
  if (body.audioBase64) {
    const audio = Buffer.from(body.audioBase64, 'base64');
    userText = (await sttTranscribe(tenantId, agent.sttConnId, audio, body.audioContentType || 'audio/wav', agent.tier === 'managed', agent.language)).trim();
    console.log(`[turn] stt=${agent.sttConnId ? 'byok' : 'managed'} userText="${userText.slice(0,100)}" (${userText.length} chars)`);
  }

  if (!userText) {
    const nudge = 'Sorry, I did not catch that. Could you say that again?';
    const tts = await ttsSynthesize(tenantId, agent.ttsConnId, nudge, { language: agent.language }, agent.tier === 'managed');
    return { reply: nudge, audioBase64: tts ? tts.audio.toString('base64') : null, audioContentType: tts?.contentType || null, history, action: 'continue' };
  }

  const nextHistory: ChatMessage[] = [...history, { role: 'user', content: userText }];

  const llm = await resolveAgentLlm(tenantId, agent.llmConnId, agent.tier === 'managed');
  if (!llm) return { reply: null, audioBase64: null, audioContentType: null, history: nextHistory, action: 'transfer', transferTo: (agent.fallback as any)?.transferTo || null };

  // Ground the agent in the client's uploaded company documents (knowledge base).
  const kbContext = await buildKnowledgeContext(agentId, tenantId).catch(() => '');
  // A published Connect flow bound to this number can add per-call instructions
  // for how the AI should handle the call (a script/behaviour), on top of the
  // agent's own persona. Same agent, different behaviour per number/flow.
  let flowInstructions = '';
  if (telnum) {
    try {
      // The DID the PBX passes may be stripped ("2085910061") while the flow's
      // telnum is stored E.164 ("+23402085910061"). Match on normalized digits.
      const digits = (v: string) => (v || '').replace(/\D/g, '');
      const want = digits(telnum);
      const published = await useDb().select({ nodes: schema.connectFlows.nodes, telnum: schema.connectFlows.telnum }).from(schema.connectFlows)
        .where(and(eq(schema.connectFlows.tenantId, tenantId), eq(schema.connectFlows.status, 'published')));
      const flow = published.find((fl) => {
        const have = digits(fl.telnum || '');
        return have && want && (have === want || have.endsWith(want) || want.endsWith(have));
      });
      const nodes = (flow?.nodes as any[]) || [];
      const aiNode = nodes.find((n) => n.type === 'route_van' && n.config?.aiInstructions);
      if (aiNode?.config?.aiInstructions) {
        flowInstructions = `\n\nFor this call specifically, follow these instructions:\n${aiNode.config.aiInstructions}`;
      }
    } catch { /* flow instructions are optional */ }
  }
  const groundedPrompt = (agent.systemPrompt || '') + flowInstructions + kbContext;
  const { text: reply, inputTokens, outputTokens } = await llmReplyWithUsage(llm, groundedPrompt, nextHistory);
  if (!reply) return { reply: null, audioBase64: null, audioContentType: null, history: nextHistory, action: 'transfer', transferTo: (agent.fallback as any)?.transferTo || null };

  let action: 'continue' | 'hangup' | 'transfer' = 'continue';
  let clean = reply;
  if (/\[transfer\]/i.test(reply)) { action = 'transfer'; clean = reply.replace(/\[transfer\]/ig, '').trim(); }
  else if (/\[end\]/i.test(reply)) { action = 'hangup'; clean = reply.replace(/\[end\]/ig, '').trim(); }

  // Always announce a handoff so the caller isn't transferred in silence. If the
  // model didn't leave a clear connecting message, prepend a standard one.
  if (action === 'transfer') {
    const announces = /connect|transfer|hold|colleague|team|someone|agent|representative|moment/i.test(clean);
    if (!clean || !announces) {
      clean = (clean ? clean + ' ' : '') + 'Let me connect you with someone who can help. Please hold for a moment.';
    }
  }

  const tts = await ttsSynthesize(tenantId, agent.ttsConnId, clean, { language: agent.language }, agent.tier === 'managed');

  const sttSeconds = body.audioBase64 ? Math.round(Buffer.from(body.audioBase64, 'base64').length / 16000) : 0;
  void recordAiUsage({
    tenantId, agentId, callId: body.callId || null,
    managed: llm.managed || !agent.ttsConnId || !agent.sttConnId,
    usage: { sttSeconds, llmInputTokens: inputTokens, llmOutputTokens: outputTokens, ttsChars: clean.length }
  });
  return { reply: clean, audioBase64: tts ? tts.audio.toString('base64') : null, audioContentType: tts?.contentType || null, history: [...nextHistory, { role: 'assistant', content: clean }], action, transferTo: action === 'transfer' ? ((agent.fallback as any)?.transferTo || null) : undefined };
});
