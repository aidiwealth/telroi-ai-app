// POST /api/admin/clients/:domain/van { vanId, status } -> operator support action:
// pause or (re)activate a client's Virtual AI Number on their behalf.
// Superadmin only. Mirrors the client-side activate logic (PBX route on live).
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { requirePlatformAdmin } from '~/server/utils/platform';
import { apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
import { loadTenant } from '~/server/utils/tenant';
import { TelroiClient } from '~/server/utils/telroi/client';
import { logEvent } from '~/server/utils/logs';

const Body = z.object({ vanId: z.string().uuid(), status: z.enum(['live', 'paused', 'draft']) });

export default defineEventHandler(async (event) => {
  const admin = await requirePlatformAdmin(event);
  if (admin.role !== 'superadmin') throw apiError('forbidden', 'Superadmin required', 403);
  const p = Body.safeParse(await readBody(event));
  if (!p.success) throw apiError('invalid', 'vanId and status required');
  const db = useDb();

  // Resolve the tenant from the route slug, then the VAN under it.
  const slug = decodeURIComponent(getRouterParam(event, 'domain')!).split('.')[0];
  const [t] = await db.select().from(schema.tenants).where(eq(schema.tenants.slug, slug)).limit(1);
  if (!t) throw apiError('not_found', 'Workspace not found', 404);
  const [van] = await db.select().from(schema.vans)
    .where(and(eq(schema.vans.id, p.data.vanId), eq(schema.vans.tenantId, t.id))).limit(1);
  if (!van) throw apiError('not_found', 'VAN not found for this client', 404);

  // Going live on a Telroi-owned number registers the inbound AVM route.
  if (p.data.status === 'live' && van.provider === 'telroi') {
    try {
      const tenant = await loadTenant(t.id);
      const client = TelroiClient.forTenant(tenant);
      await client.editNumberRoute(van.telnum, { type: 'avm', avm: { mode: 'ai', van_id: van.id } });
    } catch (e: any) {
      throw apiError('pbx_route_failed', `Could not set PBX route: ${e?.message || e}`, 502);
    }
  }

  const [row] = await db.update(schema.vans).set({ status: p.data.status })
    .where(eq(schema.vans.id, van.id)).returning();
  await logEvent({ tenantId: t.id, kind: 'system', action: 'admin.van_status', summary: `Operator set VAN ${van.name} -> ${p.data.status}` });

  // When a number goes live, let the client know it's ready for calls.
  if (p.data.status === 'live') {
    try {
      const [owner] = await db.select({ email: schema.users.email })
        .from(schema.memberships)
        .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
        .where(and(eq(schema.memberships.tenantId, t.id), eq(schema.memberships.role, 'owner')))
        .limit(1);
      if (owner?.email) {
        const { sendNumberActivatedEmail } = await import('~/server/utils/email');
        await sendNumberActivatedEmail(owner.email, { workspace: t.name, telnum: van.telnum });
      }
    } catch (e) { console.error('[van] activation email failed', e); }
  }

  return { ok: true, van: { id: row.id, name: row.name, status: row.status } };
});
