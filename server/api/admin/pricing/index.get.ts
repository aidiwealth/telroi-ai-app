import { eq } from 'drizzle-orm';
import { requireSuperAdmin } from '~/server/utils/platform';
import { useDb, schema } from '~/server/db';
export default defineEventHandler(async (event) => {
  await requireSuperAdmin(event);
  const db = useDb();
  const [p] = await db.select().from(schema.pricing).where(eq(schema.pricing.id, 'singleton')).limit(1);
  return { pricing: p || null };
});
