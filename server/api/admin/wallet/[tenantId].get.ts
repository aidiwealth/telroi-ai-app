// GET /api/admin/wallet/:tenantId -> wallet + recent ledger for a workspace.
import { eq, desc } from 'drizzle-orm';
import { requirePlatformAdmin } from '~/server/utils/platform';
import { useDb, schema } from '~/server/db';
export default defineEventHandler(async (event) => {
  await requirePlatformAdmin(event);
  const tenantId = getRouterParam(event, 'tenantId')!;
  const db = useDb();
  const [wallet] = await db.select().from(schema.wallets).where(eq(schema.wallets.tenantId, tenantId)).limit(1);
  const ledger = await db.select().from(schema.ledger)
    .where(eq(schema.ledger.tenantId, tenantId))
    .orderBy(desc(schema.ledger.createdAt)).limit(50);
  return { wallet: wallet || null, ledger };
});
