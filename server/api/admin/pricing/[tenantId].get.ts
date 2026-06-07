import { eq } from 'drizzle-orm';
import { requirePlatformAdmin } from '~/server/utils/platform';
import { useDb, schema } from '~/server/db';
export default defineEventHandler(async (event) => {
  await requirePlatformAdmin(event);
  const tenantId = getRouterParam(event, 'tenantId')!;
  const db = useDb();
  const [ov] = await db.select().from(schema.pricingOverrides).where(eq(schema.pricingOverrides.tenantId, tenantId)).limit(1);
  return { override: ov || null };
});
