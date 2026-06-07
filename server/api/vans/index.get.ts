// GET /api/vans -> list Virtual AI Numbers with their agent joined
import { eq } from 'drizzle-orm';
import { requireTenant } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  const db = useDb();
  return await db.select().from(schema.vans).where(eq(schema.vans.tenantId, s.tenantId));
});
