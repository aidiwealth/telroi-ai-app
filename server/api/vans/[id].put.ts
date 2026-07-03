// PUT /api/vans/:id -> update a VAN (validated) and keep the number's inbound
// route (number_subscriptions) in sync, since the control-app routes off that.
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { requireTenant, apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';

const Body = z.object({
  name: z.string().min(1).optional(),
  agentId: z.string().uuid().nullable().optional(),
  languages: z.array(z.string()).optional(),
  escalateTo: z.string().nullable().optional(),
  escalateAfter: z.number().int().min(0).optional(),
  crmWriteback: z.boolean().optional()
});

export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  const id = getRouterParam(event, 'id')!;
  const parsed = Body.safeParse(await readBody(event));
  if (!parsed.success) throw apiError('invalid', 'Invalid VAN update');
  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(parsed.data)) if (v !== undefined) patch[k] = v;
  if (!Object.keys(patch).length) throw apiError('invalid', 'Nothing to update');

  const db = useDb();
  const [row] = await db.update(schema.vans).set(patch)
    .where(and(eq(schema.vans.id, id), eq(schema.vans.tenantId, s.tenantId))).returning();
  if (!row) throw apiError('not_found', 'VAN not found', 404);

  // Keep the number's inbound route in sync with the VAN so the control-app
  // (which routes off number_subscriptions) reflects the current agent/escalation.
  if (row.agentId) {
    await db.update(schema.numberSubscriptions)
      .set({
        routeType: 'ai',
        routeAgentId: row.agentId,
        routeTarget: null,
        routeEscalateTo: row.escalateTo || null,
        routeEscalateAfter: row.escalateAfter ?? 0
      })
      .where(and(
        eq(schema.numberSubscriptions.telnum, row.telnum),
        eq(schema.numberSubscriptions.tenantId, s.tenantId)
      ));
  }
  return row;
});
