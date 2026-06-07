// GET /api/payment-method -> the tenant's saved card (display-safe fields only).
import { eq, desc } from 'drizzle-orm';
import { requireTenant } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  const db = useDb();
  const [pm] = await db.select().from(schema.paymentMethods)
    .where(eq(schema.paymentMethods.tenantId, s.tenantId))
    .orderBy(desc(schema.paymentMethods.createdAt)).limit(1);
  if (!pm) return { card: null };
  return { card: { brand: pm.brand, last4: pm.last4, expMonth: pm.expMonth, expYear: pm.expYear, provider: pm.provider } };
});
