// GET /api/voice/ai/debug-tts?agentId=..&tenantId=..  (secret-authed) TEMPORARY
import { eq, and } from 'drizzle-orm';
import { useDb, schema } from '~/server/db';
import { decrypt } from '~/server/utils/crypto';

export default defineEventHandler(async (event) => {
  const cfg = useRuntimeConfig() as any;
  const secret = (cfg.internalSecret as string) || (cfg.provisionAgentSecret as string) || '';
  const given = getHeader(event, 'x-telroi-internal') || '';
  if (!secret || given !== secret) throw createError({ statusCode: 401, statusMessage: 'unauthorized' });

  const q = getQuery(event);
  const agentId = String(q.agentId || '');
  const tenantId = String(q.tenantId || '');
  const steps: any = {};

  const [agent] = await useDb().select().from(schema.aiAgents)
    .where(and(eq(schema.aiAgents.id, agentId), eq(schema.aiAgents.tenantId, tenantId))).limit(1);
  steps.agentFound = !!agent;
  steps.ttsConnId = agent?.ttsConnId || null;
  if (!agent?.ttsConnId) return { steps, verdict: 'agent has no ttsConnId' };

  const [conn] = await useDb().select().from(schema.aiConnections)
    .where(and(eq(schema.aiConnections.id, agent.ttsConnId), eq(schema.aiConnections.tenantId, tenantId))).limit(1);
  steps.connFound = !!conn;
  steps.connProvider = conn?.provider || null;
  steps.connStatus = conn?.status || null;
  if (!conn) return { steps, verdict: 'ttsConnId does not resolve to a connection' };

  let apiKey = '';
  try { apiKey = decrypt(conn.apiKeyEnc); steps.decryptOk = true; steps.keyLen = apiKey.length; steps.keyLast4 = apiKey.slice(-4); }
  catch (e: any) { steps.decryptOk = false; steps.decryptError = e?.message; return { steps, verdict: 'DECRYPT FAILED — ENCRYPTION_KEY mismatch' }; }

  if (conn.provider === 'openai') {
    const res = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'tts-1', voice: 'alloy', input: 'Test one two three', response_format: 'wav' })
    });
    steps.ttsStatus = res.status;
    if (!res.ok) { steps.ttsError = (await res.text().catch(() => '')).slice(0, 300); return { steps, verdict: `OpenAI TTS HTTP ${res.status}` }; }
    const buf = Buffer.from(await res.arrayBuffer());
    steps.audioBytes = buf.length;
    return { steps, verdict: buf.length > 0 ? 'TTS OK — audio produced' : 'TTS returned empty body' };
  }
  return { steps, verdict: `provider ${conn.provider} not handled in debug` };
});
