// PUT /api/ai/connections/:id -> edit model and/or replace API key.
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { requireTenant, apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
import { encrypt, last4 } from '~/server/utils/crypto';

const Body = z.object({
  apiKey: z.string().min(8).optional(),
  model: z.string().max(100).nullable().optional()
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
  if (!Object.keys(patch).length) throw apiError('invalid', 'Nothing to update');
  const [row] = await db.update(schema.aiConnections).set(patch)
    .where(and(eq(schema.aiConnections.id, id), eq(schema.aiConnections.tenantId, s.tenantId))).returning();
  return { id: row.id, provider: row.provider, keyMasked: `••••••${row.keyLast4}`, status: row.status, model: (row.meta as any)?.model || null };
});
