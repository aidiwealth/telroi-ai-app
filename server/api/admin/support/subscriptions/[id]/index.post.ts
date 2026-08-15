// POST /api/admin/support/subscriptions/:id -> how one of our numbers behaves.
//
// The same rules as a client's number, applied to our own: the escalation mode
// follows from the target rather than being a separate setting, since leaving
// those two apart is what left every AI line answering calls and having nowhere
// to send anyone.
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { requirePlatformAdmin } from '~/server/utils/platform';
import { ensureSupportWorkspace } from '~/server/utils/support';
import { apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
import { logEvent } from '~/server/utils/logs';

const Body = z.object({
  routeType: z.enum(['person', 'department', 'ai', 'ring_all']),
  agentId: z.string().uuid().nullable().optional(),
  departmentId: z.string().uuid().nullable().optional(),
  target: z.string().nullable().optional(),
  escalateTo: z.string().nullable().optional(),
  escalateAfter: z.number().int().min(0).max(600).optional(),
  recordCalls: z.boolean().optional()
});

export default defineEventHandler(async (event) => {
  const admin = await requirePlatformAdmin(event);
  const id = getRouterParam(event, 'id')!;
  const p = Body.safeParse(await readBody(event));
  if (!p.success) throw apiError('invalid', p.error.issues[0]?.message || 'Invalid routing');
  const d = p.data;

  const ws = await ensureSupportWorkspace();
  const db = useDb();
  const [sub] = await db.select().from(schema.numberSubscriptions)
    .where(and(eq(schema.numberSubscriptions.id, id), eq(schema.numberSubscriptions.tenantId, ws.tenantId)))
    .limit(1);
  if (!sub) throw apiError('not_found', 'Number not found', 404);

  await db.update(schema.numberSubscriptions).set({
    routeType: d.routeType,
    routeAgentId: d.routeType === 'ai' ? (d.agentId || null) : null,
    departmentId: d.routeType === 'department' ? (d.departmentId || null) : null,
    routeTarget: d.routeType === 'person' ? (d.target || null) : null,
    // '__all' is how the form says anyone available. Blank means the AI handles
    // the call alone, which is a choice rather than an oversight only when it
    // was made deliberately.
    routeEscalateMode: d.routeType !== 'ai' ? 'none'
      : d.escalateTo === '__all' ? 'ring_all'
      : d.escalateTo ? 'endpoint' : 'none',
    routeEscalateTo: (d.routeType === 'ai' && d.escalateTo && d.escalateTo !== '__all') ? d.escalateTo : null,
    routeEscalateAfter: d.routeType === 'ai' ? (d.escalateAfter || 0) : 0,
    ...(d.recordCalls === undefined ? {} : { recordCalls: d.recordCalls })
  }).where(eq(schema.numberSubscriptions.id, id));

  await logEvent({
    tenantId: ws.tenantId, kind: 'system', action: 'support.number.routing',
    summary: `${admin.email} set ${sub.telnum} to ${d.routeType}${d.recordCalls ? ' (recording)' : ''}`
  });

  return { ok: true };
});
