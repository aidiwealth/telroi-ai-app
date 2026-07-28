// PUT /api/admin/support/vans/:id -> update a support VAN and keep the number's
// inbound route in sync, since the control-app routes off number_subscriptions.
//
// This was a one-line passthrough that wrote the request body straight into the
// table: anything the form sent that wasn't a column threw a 500, and nothing
// ever reached the subscription — so a support AI number kept whatever routing
// it had, and escalation settings went nowhere. Mirrors the client endpoint,
// which does this properly.
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { requirePlatformAdmin } from '~/server/utils/platform';
import { ensureSupportWorkspace } from '~/server/utils/support';
import { apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';

const Body = z.object({
  name: z.string().min(1).optional(),
  telnum: z.string().min(3).optional(),
  agentId: z.string().uuid().nullable().optional(),
  languages: z.array(z.string()).optional(),
  escalateMode: z.enum(['none', 'endpoint', 'phone', 'ring_all']).optional(),
  escalateTo: z.string().nullable().optional(),
  escalateAfter: z.number().int().min(0).optional(),
  crmWriteback: z.boolean().optional(),
  status: z.string().optional()
});

// A VAN and its subscription can hold the same number in different formats
// ("2085910061" vs "+23402085910061"), so match on the digits that matter.
const norm = (x: string) => {
  let d = String(x || '').replace(/[^0-9]/g, '');
  if (d.startsWith('234')) d = d.slice(3);
  if (d.startsWith('0')) d = d.slice(1);
  return d;
};

export default defineEventHandler(async (event) => {
  await requirePlatformAdmin(event);
  const ws = await ensureSupportWorkspace();
  const id = getRouterParam(event, 'id')!;

  const parsed = Body.safeParse(await readBody(event));
  if (!parsed.success) throw apiError('invalid', 'Invalid VAN update');
  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(parsed.data)) if (v !== undefined) patch[k] = v;
  if (!Object.keys(patch).length) throw apiError('invalid', 'Nothing to update');

  const db = useDb();
  const [row] = await db.update(schema.vans).set(patch)
    .where(and(eq(schema.vans.id, id), eq(schema.vans.tenantId, ws.tenantId))).returning();
  if (!row) throw apiError('not_found', 'VAN not found', 404);

  if (row.agentId && row.telnum) {
    const target = norm(row.telnum);
    const subs = await db.select({ id: schema.numberSubscriptions.id, telnum: schema.numberSubscriptions.telnum })
      .from(schema.numberSubscriptions)
      .where(eq(schema.numberSubscriptions.tenantId, ws.tenantId));
    const match = subs.find((x: any) => norm(x.telnum) === target);
    if (match) {
      await db.update(schema.numberSubscriptions)
        .set({
          routeType: 'ai',
          routeAgentId: row.agentId,
          routeTarget: null,
          routeEscalateMode: row.escalateMode || 'none',
          routeEscalateTo: row.escalateTo || null,
          routeEscalateAfter: row.escalateAfter ?? 0
        })
        .where(eq(schema.numberSubscriptions.id, match.id));
    }
  }
  return row;
});
