// PUT /api/ai/connections/:id -> edit model and/or replace API key.
import { z } from 'zod';
import { DEFAULT_OPENAI_BASE_URL, resolveOpenAiBaseUrl } from '~/server/utils/openai-base-url';
import { and, eq, or } from 'drizzle-orm';
import { requireTenant, apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
import { encrypt, last4 } from '~/server/utils/crypto';

const Body = z.object({
  apiKey: z.string().min(8).optional(),
  model: z.string().max(100).nullable().optional(),
  meta: z.object({ baseUrl: z.string().nullable().optional() }).strict().optional()
});

export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  const id = getRouterParam(event, 'id')!;
  const parsed = Body.safeParse(await readBody(event));
  if (!parsed.success) throw apiError('invalid', 'Invalid connection update');
  const db = useDb();
  const [existing] = await db.select().from(schema.aiConnections)
    .where(and(eq(schema.aiConnections.id, id), eq(schema.aiConnections.tenantId, s.tenantId))).limit(1);
  if (!existing) throw apiError('not_found', 'Connection not found', 404);
  const patch: Record<string, unknown> = {};
  if (parsed.data.model !== undefined) {
    const meta = { ...((existing.meta || {}) as Record<string, any>) };
    const m = (parsed.data.model || '').trim();
    if (m) meta.model = m; else delete meta.model;
    patch.meta = meta;
  }
  if (parsed.data.apiKey?.trim()) {
    patch.apiKeyEnc = encrypt(parsed.data.apiKey.trim());
    patch.keyLast4 = last4(parsed.data.apiKey.trim());
    patch.status = 'untested';
    patch.lastTestedAt = null;
  }
  if (existing.provider === 'openai' && (parsed.data.model !== undefined || parsed.data.meta?.baseUrl !== undefined)) {
    const savedMeta = (existing.meta || {}) as Record<string, unknown>;
    let currentBaseUrl: string;
    let nextBaseUrl: string;
    try {
      currentBaseUrl = resolveOpenAiBaseUrl(savedMeta.baseUrl);
      nextBaseUrl = parsed.data.meta?.baseUrl === undefined
        ? currentBaseUrl
        : resolveOpenAiBaseUrl(parsed.data.meta.baseUrl);
    } catch (e) { throw apiError('invalid', (e as Error).message); }
    const nextModel = parsed.data.model === undefined ? savedMeta.model : (parsed.data.model || '').trim();
    if (nextBaseUrl !== DEFAULT_OPENAI_BASE_URL && !(typeof nextModel === 'string' && nextModel.trim())) {
      throw apiError('invalid', 'Model is required for a custom OpenAI-compatible base URL');
    }
    if (nextBaseUrl !== currentBaseUrl) {
      if (nextBaseUrl !== DEFAULT_OPENAI_BASE_URL) {
        const [speechAgent] = await db.select({ id: schema.aiAgents.id }).from(schema.aiAgents)
          .where(and(eq(schema.aiAgents.tenantId, s.tenantId), or(eq(schema.aiAgents.sttConnId, id), eq(schema.aiAgents.ttsConnId, id))))
          .limit(1);
        if (speechAgent) throw apiError('invalid', 'Reassign this connection from agent speech-to-text and text-to-speech before changing it to a chat-only endpoint');
      }
      patch.meta = { ...savedMeta, ...((patch.meta || {}) as Record<string, unknown>), baseUrl: nextBaseUrl };
      patch.status = 'untested';
      patch.lastTestedAt = null;
    }
  } else if (parsed.data.meta?.baseUrl !== undefined) {
    throw apiError('invalid', 'baseUrl is only supported for OpenAI-compatible connections');
  }
  if (!Object.keys(patch).length) throw apiError('invalid', 'Nothing to update');
  const [row] = await db.update(schema.aiConnections).set(patch)
    .where(and(eq(schema.aiConnections.id, id), eq(schema.aiConnections.tenantId, s.tenantId))).returning();
  return { id: row.id, provider: row.provider, keyMasked: `••••••${row.keyLast4}`, status: row.status, model: (row.meta as any)?.model || null };
});
