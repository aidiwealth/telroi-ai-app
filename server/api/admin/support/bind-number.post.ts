// POST /api/admin/support/bind-number { telnum }
// Give the support workspace a real subscription for one of its numbers.
//
// A support number picked in settings is only a label until the workspace owns
// it: inbound calls need a tenant to attribute to before they can ring anyone,
// be logged, or carry an AI number. This is deliberately its own endpoint rather
// than part of the settings save — a failure here should say so, not take down
// every other setting on that page.
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { requirePlatformAdmin } from '~/server/utils/platform';
import { apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
import { ensureSupportWorkspace } from '~/server/utils/support';

const Body = z.object({ telnum: z.string().min(3) });

export default defineEventHandler(async (event) => {
  const admin = await requirePlatformAdmin(event);
  if (admin.role !== 'superadmin') throw apiError('forbidden', 'Superadmin required', 403);

  const p = Body.safeParse(await readBody(event));
  if (!p.success) throw apiError('invalid', 'telnum required', 400);
  const telnum = p.data.telnum.trim();

  const db = useDb();
  const ws = await ensureSupportWorkspace();

  const [existing] = await db.select({ id: schema.numberSubscriptions.id })
    .from(schema.numberSubscriptions)
    .where(and(eq(schema.numberSubscriptions.tenantId, ws.tenantId), eq(schema.numberSubscriptions.telnum, telnum)))
    .limit(1);

  if (existing) {
    await db.update(schema.numberSubscriptions)
      .set({ status: 'active', routeType: 'ring_all' })
      .where(eq(schema.numberSubscriptions.id, existing.id));
    return { ok: true, created: false };
  }

  // region and provider are NOT NULL with defaults; nextBillingAt is NOT NULL
  // with none, so it has to be supplied.
  const [inv] = await db.select({ provider: schema.numberInventory.provider, region: schema.numberInventory.region })
    .from(schema.numberInventory).where(eq(schema.numberInventory.telnum, telnum)).limit(1);

  await db.insert(schema.numberSubscriptions).values({
    tenantId: ws.tenantId,
    telnum,
    region: inv?.region || 'NG',
    provider: (inv?.provider as any) || 'telroi',
    status: 'active',
    routeType: 'ring_all',
    provisionState: 'provisioned',
    provisionedAt: new Date(),
    nextBillingAt: new Date(Date.now() + 30 * 86400000)
  });

  return { ok: true, created: true };
});
