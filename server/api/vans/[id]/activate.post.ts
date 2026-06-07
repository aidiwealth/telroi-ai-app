// POST /api/vans/:id/activate { status } -> go live / pause.
// Going live registers the number's route on the PBX to point at the VAN
// runtime webhook so the AI agent answers. The actual media bridge depends on
// how your Digitide PBX exposes AVM / SIP forwarding (confirm against live).
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { requireTenant, apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
import { loadTenant } from '~/server/utils/tenant';
import { TelroiClient } from '~/server/utils/telroi/client';

const Body = z.object({ status: z.enum(['live', 'paused', 'draft']) });

export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  const id = getRouterParam(event, 'id')!;
  const p = Body.safeParse(await readBody(event));
  if (!p.success) throw apiError('invalid', 'status required');
  const db = useDb();

  const [van] = await db.select().from(schema.vans)
    .where(and(eq(schema.vans.id, id), eq(schema.vans.tenantId, s.tenantId))).limit(1);
  if (!van) throw apiError('not_found', 'VAN not found', 404);

  // When going live on a Telroi-owned number, point its inbound route at AVM
  // (Automated Voice Messaging) so the AI agent runtime takes the call.
  // Sandbox: skip the real PBX call entirely and just flip status.
  const { isSandbox } = await import('~/server/utils/sandbox');
  const sandbox = await isSandbox(s.tenantId);
  if (p.data.status === 'live' && van.provider === 'telroi' && !sandbox) {
    try {
      const tenant = await loadTenant(s.tenantId);
      const client = TelroiClient.forTenant(tenant);
      // BUILD-LIVE: exact route payload depends on your PBX AVM config.
      // This is the shape per the CPBX spec; verify field names against live.
      await client.editNumberRoute(van.telnum, { type: 'avm', avm: { mode: 'ai', van_id: van.id } });
    } catch (e: any) {
      // Surface PBX errors instead of silently flipping status.
      throw apiError('pbx_route_failed', `Could not set PBX route: ${e?.message || e}`, 502);
    }
  }

  const [row] = await db.update(schema.vans).set({ status: p.data.status })
    .where(eq(schema.vans.id, id)).returning();
  return row;
});
