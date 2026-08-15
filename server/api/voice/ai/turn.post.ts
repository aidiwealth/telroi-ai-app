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
  const { agentId, tenantId, first, telnum, callId } = body || {};
  if (!agentId || !tenantId) throw createError({ statusCode: 400, statusMessage: 'agentId and tenantId required' });

  const [agent] = await useDb().select().from(schema.aiAgents)
    .where(and(eq(schema.aiAgents.id, agentId), eq(schema.aiAgents.tenantId, tenantId))).limit(1);
  if (!agent) throw createError({ statusCode: 404, statusMessage: 'agent not found' });

  // AI subscription wall: don't run the AI brain for workspaces without an active
  // subscription. Return a graceful spoken message + hang up instead of answering.
  const { aiActive } = await import('~/server/utils/entitlements');
  const gate = await aiActive(tenantId);
  if (!gate.ok) {
    const msg = 'This AI service is not active on this account. Please contact the business.';
    const tts = await ttsSynthesize(tenantId, agent.ttsConnId, msg, { language: agent.language }, agent.tier === 'managed').catch(() => null);
    // history isn't in scope here — it's read from the body further down — so
    // referencing it threw, and a workspace without an active AI subscription got
    // a 500 instead of the message explaining why.
    return { reply: msg, audioBase64: tts ? tts.audio.toString('base64') : null, audioContentType: tts?.contentType || null, history: [], action: 'hangup' };
  }

  // Sandbox workspaces get a fixed number of AI conversations to prove the product
  // works. Checked only on the first turn: a call either starts or it doesn't, so
  // nobody gets cut off mid-sentence when the cap lands during a conversation.
  if (first) {
    const { sandboxStatus } = await import('~/server/utils/sandbox-limits');
    const sbx = await sandboxStatus(tenantId).catch(() => null);
    if (sbx?.sandbox && sbx.callsExhausted) {
      const msg = 'This number is still in trial mode and has used all of its test calls. Please try again later.';
      const tts = await ttsSynthesize(tenantId, agent.ttsConnId, msg, { language: agent.language }, agent.tier === 'managed').catch(() => null);
      console.warn(`[turn] sandbox call cap reached for tenant ${tenantId} (${sbx.callsUsed}/${sbx.callCap})`);
      return { reply: msg, audioBase64: tts ? tts.audio.toString('base64') : null, audioContentType: tts?.contentType || null, history: [], action: 'hangup' };
    }
  }

  // A trialling workspace's calls are capped in length as well as in total spend.
  // The allowance alone only decides whether the NEXT call starts — one long
  // conversation could spend it several times over before anything noticed.
  // Returned on the greeting so the adapter knows when to end the call; zero
  // means no limit.
  let callMaxSeconds = 0;
  if (first && agent.tier === 'managed') {
    const { trialAiStatus } = await import('~/server/utils/trial-ai');
    const trial = await trialAiStatus(tenantId).catch(() => null);
    if (trial?.onTrial) callMaxSeconds = trial.callMaxSeconds;
  }

  // Speak a line we've written rather than one the model produced. Used when a
  // call is ending for a reason the caller deserves to hear — a trial limit, say —
  // where running the brain would be wasteful and might not say the right thing.
  if (typeof body.say === 'string' && body.say.trim()) {
    const line = body.say.trim().slice(0, 300);
    const tts = await ttsSynthesize(tenantId, agent.ttsConnId, line, { language: agent.language }, agent.tier === 'managed').catch(() => null);
    return { reply: line, audioBase64: tts ? tts.audio.toString('base64') : null, audioContentType: tts?.contentType || null, history: [], action: 'hangup' };
  }

  const history: ChatMessage[] = Array.isArray(body.history) ? body.history : [];

  if (first) {
    let greeting = agent.greeting || 'Hello, thanks for calling. How can I help you today?';

    // The recording notice, where the carrier cannot play one itself. Asterisk
    // plays a file from the dialplan before any of this; Telnyx has no dialplan,
    // so the adapter asks for it here and it rides on the greeting — same voice,
    // no extra second of silence, and said whether or not a model cooperates.
    //
    // Only the caller's side matters legally, and a notice buried after the
    // conversation has started is not a notice.
    if (body.needsNotice) {
      greeting = `Please note, this call is being recorded. ${greeting}`;
    }

    const tts = await ttsSynthesize(tenantId, agent.ttsConnId, greeting, { language: agent.language }, agent.tier === 'managed');
    return { reply: greeting, audioBase64: tts ? tts.audio.toString('base64') : null, audioContentType: tts?.contentType || null, history: [{ role: 'assistant', content: greeting }], action: 'continue', callMaxSeconds };
  }

  let userText = '';
  if (body.audioBase64) {
    const audio = Buffer.from(body.audioBase64, 'base64');
    const _sttT0 = Date.now();
    userText = (await sttTranscribe(tenantId, agent.sttConnId, audio, body.audioContentType || 'audio/wav', agent.tier === 'managed', agent.language)).trim();
    console.log(`[turn:timing] stt=${Date.now() - _sttT0}ms`);
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
  // Voice-specific brevity: this is a PHONE call, not chat. Long replies feel
  // sluggish (10s+ of TTS per turn) and callers can't skim audio. Applies to every
  // agent on the voice path; agents keep their own persona/knowledge otherwise.
  const voiceStyle = [
    '',
    '',
    'CRITICAL — YOU ARE ON A PHONE CALL. Spoken replies, not written ones:',
    '- HARD LIMIT: 30 words maximum per reply. Shorter is better. One sentence is ideal.',
    '- Answer ONLY what was asked. Do not add context, options, or follow-ups they did not request.',
    '- Never list more than 2 items. If there are more, say "a few options" and let them ask.',
    '- No markdown, bullets, emoji, or symbols — every character is read aloud.',
    '- Prices/numbers: say them simply and once.',
    '- End your turn. Do not ask multiple questions or stack a question onto a long answer.',
    'A caller cannot skim audio. Long replies waste their time and feel robotic. Be brief.',
    '',
    'NAMES:',
    'If they tell you their name, end your reply with [name:THEIR NAME] so we can',
    'label their record. Only when they actually give it — never guess from the',
    'number, and do not ask for it unless the conversation needs it.'
  ].join('\n');
  // The departments this workspace actually has, so a caller asking about their
  // bill reaches billing without being read a menu. Naming them in the marker
  // means the handoff knows where to ring rather than falling to one default.
  let deptContext = '';
  try {
    const { eq } = await import('drizzle-orm');
    const { useDb, schema } = await import('~/server/db');
    const rows = await useDb().select({ name: schema.departments.name, desc: schema.departments.description })
      .from(schema.departments).where(eq(schema.departments.tenantId, tenantId));
    if (rows.length) {
      deptContext = [
        '',
        'TRANSFERRING TO A DEPARTMENT:',
        'These teams can take the call:',
        ...rows.map((d) => `- ${d.name}${d.desc ? ': ' + d.desc : ''}`),
        'If what they need clearly belongs to one, end your reply with [transfer:NAME]',
        'using the exact name above — do not ask which team, you already know.',
        'If they ask for a person generally and it is not clear which team, ask once',
        'which of these they need, then transfer. If still unclear, use [transfer].'
      ].join('\n');
    }
  } catch { /* no departments — the plain [transfer] path still works */ }

  const groundedPrompt = (agent.systemPrompt || '') + flowInstructions + kbContext + deptContext + voiceStyle;
  const _llmT0 = Date.now();
  // Hard cap for voice: prompt rules alone weren't holding (replies still ran
  // 180+ chars / 12s of speech). ~80 tokens is roughly 60 words — enough for a
  // complete phone answer, impossible to monologue past.
  const { text: reply, inputTokens, outputTokens } = await llmReplyWithUsage(llm, groundedPrompt, nextHistory, 80);
  console.log(`[turn:timing] llm=${Date.now() - _llmT0}ms replyChars=${(reply || '').length}`);
  if (!reply) return { reply: null, audioBase64: null, audioContentType: null, history: nextHistory, action: 'transfer', transferTo: (agent.fallback as any)?.transferTo || null };

  let action: 'continue' | 'hangup' | 'transfer' = 'continue';
  let clean = reply;
  // [transfer:billing] names a team; [transfer] alone falls back to the VAN's
  // configured target as before.
  // A name the caller gave. Written to their contact so a board of numbers
  // becomes a board of people — and only where the contact has none yet, since
  // an operator who typed a name should not have it overwritten by whatever
  // somebody said on the phone.
  let callerName: string | null = null;
  const nameMatch = reply.match(/\[name:([^\]]+)\]/i);
  if (nameMatch) {
    callerName = nameMatch[1].trim().slice(0, 80);
    reply = reply.replace(/\[name:[^\]]+\]/ig, '').trim();
  }

  // Write the name to their contact. The caller's number is not in this payload
  // and threading it through three layers is how a value gets quietly dropped —
  // callId is already here, and the call knows who rang.
  if (callerName && callId) {
    try {
      const { eq, and, sql, isNull } = await import('drizzle-orm');
      const db = useDb();
      const [ev] = await db.select({ phone: schema.callEvents.phone })
        .from(schema.callEvents)
        .where(and(eq(schema.callEvents.tenantId, tenantId), eq(schema.callEvents.callid, String(callId))))
        .limit(1);
      const last9 = (ev?.phone || '').replace(/\D/g, '').slice(-9);
      if (last9) {
        // Only where there is none: an operator who typed a name should not have
        // it replaced by whatever somebody said on a call.
        await db.update(schema.crmContacts)
          .set({ name: callerName })
          .where(and(
            eq(schema.crmContacts.tenantId, tenantId),
            sql`right(regexp_replace(${schema.crmContacts.phone}, '\D', '', 'g'), 9) = ${last9}`,
            isNull(schema.crmContacts.name)
          ));
      }
    } catch (e: any) {
      // A name not saved is a card still showing a number. Not worth failing a
      // live call over.
      console.error('[turn] contact name write failed:', e?.message);
    }
  }

  let transferDept: string | null = null;
  const deptMatch = reply.match(/\[transfer:([^\]]+)\]/i);
  if (deptMatch) {
    action = 'transfer';
    transferDept = deptMatch[1].trim();
    clean = reply.replace(/\[transfer:[^\]]+\]/ig, '').trim();
  }
  else if (/\[transfer\]/i.test(reply)) { action = 'transfer'; clean = reply.replace(/\[transfer\]/ig, '').trim(); }
  else if (/\[end\]/i.test(reply)) { action = 'hangup'; clean = reply.replace(/\[end\]/ig, '').trim(); }

  // Always announce a handoff so the caller isn't transferred in silence. If the
  // model didn't leave a clear connecting message, prepend a standard one.
  if (action === 'transfer') {
    const announces = /connect|transfer|hold|colleague|team|someone|agent|representative|moment/i.test(clean);
    if (!clean || !announces) {
      clean = (clean ? clean + ' ' : '') + 'Let me connect you with someone who can help. Please hold for a moment.';
    }
  }

  const _ttsT0 = Date.now();
  const tts = await ttsSynthesize(tenantId, agent.ttsConnId, clean, { language: agent.language }, agent.tier === 'managed');
  console.log(`[turn:timing] tts=${Date.now() - _ttsT0}ms chars=${clean.length} audioBytes=${tts?.audio?.length || 0}`);

  const sttSeconds = body.audioBase64 ? Math.round(Buffer.from(body.audioBase64, 'base64').length / 16000) : 0;
  void recordAiUsage({
    tenantId, agentId, callId: body.callId || null,
    managed: llm.managed || !agent.ttsConnId || !agent.sttConnId,
    usage: { sttSeconds, llmInputTokens: inputTokens, llmOutputTokens: outputTokens, ttsChars: clean.length }
  });
  return {
    reply: clean,
    audioBase64: tts ? tts.audio.toString('base64') : null,
    audioContentType: tts?.contentType || null,
    history: [...nextHistory, { role: 'assistant', content: clean }],
    action,
    transferTo: action === 'transfer' ? ((agent.fallback as any)?.transferTo || null) : undefined,
    // Which team, when the caller made it clear. The bridge rings that
    // department's members by its own strategy; without one it falls back to
    // whatever the VAN's escalation is set to.
    transferDepartment: action === 'transfer' ? transferDept : undefined
  };
});
