// POST /api/numbers/[id]/routing  { routeType, target?, departmentId?, agentId?, escalateTo?, escalateAfter? }
// Unified, carrier-agnostic inbound routing for ANY number (Digidite, Sotel,
// Twilio, Telnyx). One model the customer sees regardless of vendor:
//   - person      -> ring a person/extension
//   - department  -> ring a department / queue
//   - ai          -> answer with an AI agent (a VAN is synced under the hood,
//                    with human escalation), so AI numbers and PBX numbers are
//                    configured from the exact same place.
// The vendor is an implementation detail handled by the call-time resolver.
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { requireTenant, apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';

const Body = z.object({
  routeType: z.enum(['person', 'department', 'ai']),
  target: z.string().optional(),          // person: extension/user id
  departmentId: z.string().uuid().optional(),
  agentId: z.string().uuid().optional(),  // ai
  escalateTo: z.string().optional(),
  escalateAfter: z.number().int().min(0).max(600).optional()
});

export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  const id = getRouterParam(event, 'id');
  const p = Body.safeParse(await readBody(event));
  if (!id || !p.success) throw apiError('invalid', 'A route type is required');
  const db = useDb();

  const [sub] = await db.select().from(schema.numberSubscriptions)
    .where(and(eq(schema.numberSubscriptions.id, id), eq(schema.numberSubscriptions.tenantId, s.tenantId))).limit(1);
  if (!sub) throw apiError('not_found', 'Number not found', 404);

  const d = p.data;
  // Validate per type.
  if (d.routeType === 'person' && !d.target) throw apiError('invalid', 'Choose who to route to');
  if (d.routeType === 'department' && !d.departmentId) throw apiError('invalid', 'Choose a department');
  if (d.routeType === 'ai' && !d.agentId) throw apiError('invalid', 'Choose an AI agent');

  // Persist unified routing on the subscription (single source of truth).
  await db.update(schema.numberSubscriptions).set({
    routeType: d.routeType,
    routeTarget: d.routeType === 'person' ? (d.target || null) : null,
    departmentId: d.routeType === 'department' ? (d.departmentId || null) : sub.departmentId,
    routeAgentId: d.routeType === 'ai' ? (d.agentId || null) : null,
    routeEscalateTo: d.routeType === 'ai' ? (d.escalateTo || null) : null,
    routeEscalateAfter: d.routeType === 'ai' ? (d.escalateAfter || 0) : 0
  }).where(eq(schema.numberSubscriptions.id, sub.id));

  // For AI routing, sync a VAN under the hood so the AI runtime + escalation use
  // the same machinery as before — the customer just picked "AI" in one place.
  if (d.routeType === 'ai') {
    const [existing] = await db.select().from(schema.vans)
      .where(and(eq(schema.vans.tenantId, s.tenantId), eq(schema.vans.telnum, sub.telnum))).limit(1);
    const vanVals = {
      tenantId: s.tenantId, name: `${sub.telnum} (AI)`, telnum: sub.telnum, provider: sub.provider as any,
      agentId: d.agentId!, escalateTo: d.escalateTo || null, escalateAfter: d.escalateAfter || 0, status: 'live' as const
    };
    if (existing) {
      await db.update(schema.vans).set({ agentId: d.agentId!, escalateTo: d.escalateTo || null, escalateAfter: d.escalateAfter || 0, status: 'live', provider: sub.provider as any })
        .where(eq(schema.vans.id, existing.id));
    } else {
      await db.insert(schema.vans).values(vanVals);
    }
  } else {
    // Switched AWAY from AI -> pause any VAN bound to this number so it stops answering.
    await db.update(schema.vans).set({ status: 'paused' })
      .where(and(eq(schema.vans.tenantId, s.tenantId), eq(schema.vans.telnum, sub.telnum)));
  }

  // For Digidite/PBX numbers, also push person/department routing to the PBX so
  // its dialplan stays in sync (best-effort; other carriers route via resolver).
  if (d.routeType !== 'ai' && (sub.provider === 'telroi')) {
    try {
      const { telroiFor } = await import('~/server/utils/tenant');
      const client = await telroiFor(s.tenantId);
      const body: any = d.routeType === 'person' ? { type: 'user', user: d.target } : { type: 'group', group: d.departmentId };
      await client.editNumberRoute(sub.telnum, body);
    } catch { /* PBX sync best-effort; unified record is authoritative */ }
  }

  return { ok: true, routeType: d.routeType };
});
