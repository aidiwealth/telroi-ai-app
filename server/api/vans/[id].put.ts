// PUT /api/vans/:id -> update a VAN (validated) and keep the number's inbound
// route (number_subscriptions) in sync, since the control-app routes off that.
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { requireTenant, apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';

const Body = z.object({
  name: z.string().min(1).optional(),
  telnum: z.string().min(3).optional(),
  agentId: z.string().uuid().nullable().optional(),
  languages: z.array(z.string()).optional(),
  escalateMode: z.enum(['none','endpoint','phone','ring_all']).optional(),
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

  // If the number is being changed, the tenant must own the NEW number, and we
  // clear the OLD number's AI route so it doesn't keep answering as this VAN.
  if (patch.telnum) {
    const [owned] = await db.select().from(schema.numberSubscriptions)
      .where(and(eq(schema.numberSubscriptions.telnum, patch.telnum as string), eq(schema.numberSubscriptions.tenantId, s.tenantId)))
      .limit(1);
    if (!owned) throw apiError('not_owned', 'You must own this number before assigning it. Buy it on the Numbers page first.', 400);
    const [prev] = await db.select({ telnum: schema.vans.telnum }).from(schema.vans)
      .where(and(eq(schema.vans.id, id), eq(schema.vans.tenantId, s.tenantId))).limit(1);
    if (prev && prev.telnum && prev.telnum !== patch.telnum) {
      const norm0 = (x: string) => { let d = String(x||'').replace(/[^0-9]/g,''); if (d.startsWith('234')) d=d.slice(3); if (d.startsWith('0')) d=d.slice(1); return d; };
      const oldTarget = norm0(prev.telnum);
      const allSubs = await db.select({ id: schema.numberSubscriptions.id, telnum: schema.numberSubscriptions.telnum, routeAgentId: schema.numberSubscriptions.routeAgentId })
        .from(schema.numberSubscriptions).where(eq(schema.numberSubscriptions.tenantId, s.tenantId));
      const oldMatch = allSubs.find((x: any) => norm0(x.telnum) === oldTarget);
      if (oldMatch) {
        await db.update(schema.numberSubscriptions)
          .set({ routeType: 'person', routeAgentId: null, routeTarget: null })
          .where(eq(schema.numberSubscriptions.id, oldMatch.id));
      }
    }
  }
  const [row] = await db.update(schema.vans).set(patch)
    .where(and(eq(schema.vans.id, id), eq(schema.vans.tenantId, s.tenantId))).returning();
  if (!row) throw apiError('not_found', 'VAN not found', 404);

  // Keep the number's inbound route in sync with the VAN so the control-app
  // (which routes off number_subscriptions) reflects the current agent/escalation.
  if (row.agentId) {
    // The VAN and its subscription can store the number in different formats
    // (e.g. "2085910061" vs "+23402085910061"), so match on a normalized key
    // rather than exact string, then update by the subscription's own id.
    const norm = (x: string) => { let d = String(x||'').replace(/[^0-9]/g,''); if (d.startsWith('234')) d=d.slice(3); if (d.startsWith('0')) d=d.slice(1); return d; };
    const target = norm(row.telnum);
    const subs = await db.select({ id: schema.numberSubscriptions.id, telnum: schema.numberSubscriptions.telnum })
      .from(schema.numberSubscriptions)
      .where(eq(schema.numberSubscriptions.tenantId, s.tenantId));
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
