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
  const text = String(body?.text || '').slice(0, 300).trim();
  if (!tenantId || !text) throw createError({ statusCode: 400, statusMessage: 'tenantId and text required' });

  let ttsConnId: string | null = null;
  let allowManaged = true;
  if (agentId) {
    const [agent] = await useDb().select().from(schema.aiAgents).where(eq(schema.aiAgents.id, agentId)).limit(1);
    if (agent) { ttsConnId = agent.ttsConnId; allowManaged = agent.tier === 'managed'; }
  }

  const tts = await ttsSynthesize(tenantId, ttsConnId, text, {}, allowManaged);
  if (!tts) return { audioBase64: null, audioContentType: null };
  return { audioBase64: tts.audio.toString('base64'), audioContentType: tts.contentType };
});
