// POST /api/ai/connections { provider, apiKey, meta } -> encrypt + store
import { z } from 'zod';
import { DEFAULT_OPENAI_BASE_URL, resolveOpenAiBaseUrl } from '~/server/utils/openai-base-url';
import { requireTenant, apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
import { encrypt, last4 } from '~/server/utils/crypto';

const Body = z.object({
  provider: z.enum(['openai', 'anthropic', 'deepgram', 'elevenlabs', 'google', 'google-cloud', 'grok']),
  apiKey: z.string().min(8),
  model: z.string().max(100).optional(),
  meta: z.record(z.any()).optional()
});

export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  const parsed = Body.safeParse(await readBody(event));
  if (!parsed.success) throw apiError('invalid', 'Provider and API key required');
  const db = useDb();
  const meta = { ...(parsed.data.meta ?? {}) } as Record<string, any>;
  if (parsed.data.provider === 'openai') {
    try { meta.baseUrl = resolveOpenAiBaseUrl(meta.baseUrl); }
    catch (e) { throw apiError('invalid', (e as Error).message); }
    if (meta.baseUrl !== DEFAULT_OPENAI_BASE_URL && !parsed.data.model?.trim() && !meta.model?.trim()) {
      throw apiError('invalid', 'Model is required for a custom OpenAI-compatible base URL');
    }
  }
  if (parsed.data.model?.trim()) meta.model = parsed.data.model.trim();
  const [row] = await db.insert(schema.aiConnections).values({
    tenantId: s.tenantId,
    provider: parsed.data.provider,
    apiKeyEnc: encrypt(parsed.data.apiKey),
    keyLast4: last4(parsed.data.apiKey),
    meta
  }).returning();
  return { id: row.id, provider: row.provider, keyMasked: `••••••${row.keyLast4}`, status: row.status };
});
