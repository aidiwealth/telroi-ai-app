// PUT /api/admin/support/agents/:id -> update the support-workspace agent (validated).
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { requirePlatformAdmin } from '~/server/utils/platform';
import { apiError } from '~/server/utils/api';
import { ensureSupportWorkspace } from '~/server/utils/support';
import { useDb, schema } from '~/server/db';

const Body = z.object({
  name: z.string().min(1).optional(),
  greeting: z.string().nullable().optional(),
  systemPrompt: z.string().nullable().optional(),
  tier: z.enum(['byok', 'managed']).optional(),
  sttConnId: z.string().uuid().nullable().optional(),
  llmConnId: z.string().uuid().nullable().optional(),
  ttsConnId: z.string().uuid().nullable().optional(),
  fallback: z.record(z.any()).optional()
});

export default defineEventHandler(async (event) => {
  await requirePlatformAdmin(event);
  const ws = await ensureSupportWorkspace();
  const id = getRouterParam(event, 'id')!;
  const parsed = Body.safeParse(await readBody(event));
  if (!parsed.success) throw apiError('invalid', 'Invalid agent update');
  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(parsed.data)) if (v !== undefined) patch[k] = v;
  if (!Object.keys(patch).length) throw apiError('invalid', 'Nothing to update');
  const db = useDb();
  const connIds = [patch.sttConnId, patch.llmConnId, patch.ttsConnId].filter((x): x is string => typeof x === 'string');
  if (connIds.length) {
    const owned = await db.select({ id: schema.aiConnections.id }).from(schema.aiConnections)
      .where(eq(schema.aiConnections.tenantId, ws.tenantId));
    const ownedSet = new Set(owned.map((c: any) => c.id));
    for (const cid of connIds) if (!ownedSet.has(cid)) throw apiError('invalid', 'Unknown connection', 400);
  }
  const [row] = await db.update(schema.aiAgents).set(patch)
    .where(and(eq(schema.aiAgents.id, id), eq(schema.aiAgents.tenantId, ws.tenantId))).returning();
  if (!row) throw apiError('not_found', 'Agent not found', 404);
  return row;
});
