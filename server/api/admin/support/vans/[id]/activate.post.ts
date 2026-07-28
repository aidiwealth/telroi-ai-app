// POST /api/admin/support/vans/:id/activate { status } -> go live / pause.
//
// This only flipped a status column, so a support AI number could read as live
// while nothing routed to it — the control-app routes off number_subscriptions,
// and nothing here ever touched them.
//
// Deliberately no PBX client call: the client endpoint still makes one against
// the old provisioning path, but routing has since moved to the subscription,
// which is what the control-app actually reads.
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { requirePlatformAdmin } from '~/server/utils/platform';
import { ensureSupportWorkspace } from '~/server/utils/support';
import { apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';

const Body = z.object({ status: z.enum(['live', 'paused', 'draft']) });

// A VAN and its subscription can hold the same number in different formats.
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
  const p = Body.safeParse(await readBody(event));
  if (!p.success) throw apiError('invalid', 'status required');

  const db = useDb();
  const [van] = await db.select().from(schema.vans)
    .where(and(eq(schema.vans.id, id), eq(schema.vans.tenantId, ws.tenantId))).limit(1);
  if (!van) throw apiError('not_found', 'VAN not found', 404);

  if (van.agentId && van.telnum) {
    const target = norm(van.telnum);
    const subs = await db.select({ id: schema.numberSubscriptions.id, telnum: schema.numberSubscriptions.telnum })
      .from(schema.numberSubscriptions)
      .where(eq(schema.numberSubscriptions.tenantId, ws.tenantId));
    const match = subs.find((x: any) => norm(x.telnum) === target);
    if (match) {
      await db.update(schema.numberSubscriptions)
        .set({
          routeType: 'ai',
          routeAgentId: van.agentId,
          routeTarget: null,
          routeEscalateMode: van.escalateMode || 'none',
          routeEscalateTo: van.escalateTo || null,
          routeEscalateAfter: van.escalateAfter ?? 0
        })
        .where(eq(schema.numberSubscriptions.id, match.id));
    }
  }

  const [row] = await db.update(schema.vans).set({ status: p.data.status })
    .where(and(eq(schema.vans.id, id), eq(schema.vans.tenantId, ws.tenantId))).returning();
  return row;
});
