// GET /api/live-call/widget-key -> the tenant's widget key (generates if absent).
import { eq } from 'drizzle-orm';
import { requireTenant } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
import { randomBytes } from 'node:crypto';
export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  const db = useDb();
  const [t] = await db.select().from(schema.tenants).where(eq(schema.tenants.id, s.tenantId)).limit(1);
  let key = t?.widgetKey;
  if (!key) {
    key = 'wgt_' + randomBytes(16).toString('hex');
    await db.update(schema.tenants).set({ widgetKey: key }).where(eq(schema.tenants.id, s.tenantId));
  }
  return { widgetKey: key };
});
