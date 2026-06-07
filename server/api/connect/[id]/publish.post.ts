// POST /api/connect/:id/publish -> write the flow's routing to the PBX and
// register workflow webhooks. The entry node determines the number's route.
import { and, eq } from 'drizzle-orm';
import { requireTenant, apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
import { loadTenant } from '~/server/utils/tenant';
import { TelroiClient } from '~/server/utils/telroi/client';

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

  const route = entryToRoute(flow.nodes as any[]);
  if (!route) throw apiError('no_entry', 'Flow needs an entry node', 400);

  const tenant = await loadTenant(s.tenantId);
  const client = TelroiClient.forTenant(tenant);

  // Write the route to the PBX. Surface real PBX errors (field shapes vary).
  try {
    await client.editNumberRoute(flow.telnum, route);
    // Register workflow webhooks (the dashboard receiver fans them out).
    const base = useRuntimeConfig().public.appBaseUrl;
    if ((flow.workflows as any[])?.length) {
      await client.addWebhook({ type: 'history', url: `${base}/api/webhooks/telroi` }).catch(() => {});
    }
  } catch (e: any) {
    throw apiError('publish_failed', `PBX rejected the route: ${e?.message || e}`, 502);
  }

  const [row] = await db.update(schema.connectFlows)
    .set({ status: 'published', publishedAt: new Date() }).where(eq(schema.connectFlows.id, id)).returning();
  return row;
});
