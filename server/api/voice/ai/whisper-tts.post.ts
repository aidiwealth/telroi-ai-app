// server/api/voice/ai/whisper-tts.post.ts
// Synthesizes a short "whisper" line played to a HUMAN agent right before an
// AI->human escalation bridge connects, so they hear who's calling and why.
// Auth: shared internal secret (same as /ai/turn, /ai/finalize).
import { eq } from 'drizzle-orm';
import { useDb, schema } from '~/server/db';
import { ttsSynthesize } from '~/server/utils/voice/ai-brain';

export default defineEventHandler(async (event) => {
  const cfg = useRuntimeConfig() as any;
  const secret = (cfg.internalSecret as string) || (cfg.provisionAgentSecret as string) || '';
  const given = getHeader(event, 'x-telroi-internal') || '';
  if (!secret || given !== secret) throw createError({ statusCode: 401, statusMessage: 'unauthorized' });

  const body = await readBody(event).catch(() => ({} as any));
  const { tenantId, agentId } = body || {};
  // 900, not 300. The 300 was right for a whisper line announcing a caller,
  // which is what this was written for — but notifications synthesise through
  // the same endpoint and allow 900, so a longer one was cut mid-sentence and
  // the client charged for characters nobody heard.
  const text = String(body?.text || '').slice(0, 900).trim();
  if (!tenantId || !text) throw createError({ statusCode: 400, statusMessage: 'tenantId and text required' });

  let ttsConnId: string | null = null;
  let allowManaged = true;
  if (agentId) {
    const [agent] = await useDb().select().from(schema.aiAgents).where(eq(schema.aiAgents.id, agentId)).limit(1);
    if (agent) { ttsConnId = agent.ttsConnId; allowManaged = agent.tier === 'managed'; }
  }

  // A shade faster than default. The stock pace reads as slow on a phone, and
  // a notification that drags is one people hang up on — 1.1 is brisker without
  // sounding hurried.
  const tts = await ttsSynthesize(tenantId, ttsConnId, text, { speed: 1.1 }, allowManaged);
  if (!tts) return { audioBase64: null, audioContentType: null };
  return { audioBase64: tts.audio.toString('base64'), audioContentType: tts.contentType };
});
