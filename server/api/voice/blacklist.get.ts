// GET /api/voice/blacklist -> the tenant's local (carrier-agnostic) block list.
import { eq, desc } from 'drizzle-orm';
import { requireTenant } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  const db = useDb();
  const items = await db.select().from(schema.blacklist)
    .where(eq(schema.blacklist.tenantId, s.tenantId)).orderBy(desc(schema.blacklist.createdAt));
  return { items };
});
