import { z } from 'zod';
import { requirePlatformAdmin } from '~/server/utils/platform';
import { apiError } from '~/server/utils/api';
import { ensureSupportWorkspace } from '~/server/utils/support';
import { useDb, schema } from '~/server/db';
import { encrypt, last4 } from '~/server/utils/crypto';
const Body = z.object({
  provider: z.enum(['openai', 'anthropic', 'deepgram', 'elevenlabs', 'google', 'grok']),
  apiKey: z.string().min(8), model: z.string().max(100).optional(), meta: z.record(z.any()).optional()
});
export default defineEventHandler(async (event) => {
  await requirePlatformAdmin(event);
  const ws = await ensureSupportWorkspace();
  const parsed = Body.safeParse(await readBody(event));
  if (!parsed.success) throw apiError('invalid', 'Provider and API key required');
  const db = useDb();
  const meta = { ...(parsed.data.meta ?? {}) } as Record<string, any>;
  if (parsed.data.model?.trim()) meta.model = parsed.data.model.trim();
  const [row] = await db.insert(schema.aiConnections).values({
    tenantId: ws.tenantId, provider: parsed.data.provider,
    apiKeyEnc: encrypt(parsed.data.apiKey), keyLast4: last4(parsed.data.apiKey), meta
  }).returning();
  return { id: row.id, provider: row.provider, keyMasked: `••••••${row.keyLast4}`, status: row.status };
});
