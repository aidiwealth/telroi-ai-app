import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { requirePlatformAdmin } from '~/server/utils/platform';
import { apiError } from '~/server/utils/api';
import { ensureSupportWorkspace } from '~/server/utils/support';
import { useDb, schema } from '~/server/db';
const Body = z.object({
  name: z.string().min(1), telnum: z.string().min(3),
  agentId: z.string().uuid().optional(), languages: z.array(z.string()).optional(),
  escalateTo: z.string().optional(), escalateAfter: z.number().int().min(0).optional(),
  crmWriteback: z.boolean().optional()
});
export default defineEventHandler(async (event) => {
  await requirePlatformAdmin(event);
  const ws = await ensureSupportWorkspace();
  const p = Body.safeParse(await readBody(event));
  if (!p.success) throw apiError('invalid', 'VAN name and number required');
  const db = useDb();

  // Resolve the carrier the number is on, from a support subscription first,
  // else from inventory. Numbers must come from provisioning, not be typed ad-hoc.
  const [sub] = await db.select().from(schema.numberSubscriptions)
    .where(and(eq(schema.numberSubscriptions.telnum, p.data.telnum), eq(schema.numberSubscriptions.tenantId, ws.tenantId))).limit(1);
  let provider = sub?.provider as string | undefined;
  if (!provider) {
    const [invRow] = await db.select().from(schema.numberInventory)
      .where(eq(schema.numberInventory.telnum, p.data.telnum)).limit(1);
    if (!invRow) throw apiError('not_provisioned', 'That number is not provisioned. Add it under Number inventory first.', 400);
    provider = invRow.provider;
    // Claim the inventory number to the support workspace + create a subscription
    // so it's properly held (mirrors how a client acquires a number).
    if (invRow.status !== 'sold' || invRow.soldToTenantId === ws.tenantId) {
      await db.update(schema.numberInventory).set({ status: 'sold', soldToTenantId: ws.tenantId }).where(eq(schema.numberInventory.id, invRow.id));
      await db.insert(schema.numberSubscriptions).values({
        tenantId: ws.tenantId, telnum: invRow.telnum, region: invRow.region, provider: invRow.provider,
        status: 'active', channels: 1, nextBillingAt: new Date(Date.now() + 30 * 864e5)
      }).onConflictDoNothing();
    }
  }
  const [row] = await db.insert(schema.vans).values({ tenantId: ws.tenantId, ...p.data, provider: provider as any }).returning();
  return row;
});
