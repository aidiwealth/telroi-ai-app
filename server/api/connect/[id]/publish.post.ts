// POST /api/connect/:id/publish -> write the flow's routing to the PBX and
// register workflow webhooks. The entry node determines the number's route.
import { and, eq } from 'drizzle-orm';
import { requireTenant, apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';

// Map a Connect entry node to a Telroi number-route payload.
function entryToRoute(nodes: any[]): Record<string, any> | null {
  const entry = nodes?.[0];
  if (!entry) return null;
  switch (entry.type) {
    case 'route_user':  return { type: 'user', user: entry.config?.target };
    case 'route_group': return { type: 'group', group: entry.config?.target };
    case 'route_van':   return { type: 'avm', avm: { mode: 'ai', van_id: entry.config?.target } };
    case 'menu':        return { type: 'ivr', ivr: { greeting: entry.config?.mediaId, options: entry.config?.options } };
    case 'greeting':    return { type: 'greeting', greeting: { media: entry.config?.mediaId, next: entry.config?.next } };
    case 'voicemail':   return { type: 'voicemail' };
    default: return null;
  }
}

export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  const id = getRouterParam(event, 'id')!;
  const db = useDb();

  const [flow] = await db.select().from(schema.connectFlows)
    .where(and(eq(schema.connectFlows.id, id), eq(schema.connectFlows.tenantId, s.tenantId))).limit(1);
  if (!flow) throw apiError('not_found', 'Flow not found', 404);
  if (!flow.telnum) throw apiError('no_number', 'Bind a phone number before publishing', 400);

  const entry = (flow.nodes as any[])?.[0];
  if (!entry) throw apiError('no_entry', 'Flow needs an entry step', 400);

  // The inbound resolver reads the published flow directly from the DB and a
  // published flow overrides flat routing — so publishing is simply marking it
  // published. We ALSO mirror the entry step onto the number's flat route, so
  // any consumer not yet flow-aware (or if the flow is later unpublished) still
  // has a sensible fallback. Terminal entries map cleanly; IVR entries fall back
  // to the flow (which the resolver handles).
  try {
    const set: any = {};
    if (entry.type === 'route_van') { set.routeType = 'ai'; set.routeAgentId = entry.config?.target || null; }
    else if (entry.type === 'route_user') { set.routeType = 'person'; set.routeTarget = entry.config?.target || null; }
    else if (entry.type === 'route_group') { set.routeType = 'department'; set.departmentId = entry.config?.target || null; }
    if (Object.keys(set).length) {
      await db.update(schema.numberSubscriptions).set(set)
        .where(and(eq(schema.numberSubscriptions.tenantId, s.tenantId), eq(schema.numberSubscriptions.telnum, flow.telnum!)));
    }
  } catch { /* mirror is best-effort; the flow itself is authoritative */ }

  const [row] = await db.update(schema.connectFlows)
    .set({ status: 'published', publishedAt: new Date() }).where(eq(schema.connectFlows.id, id)).returning();
  return row;
});
