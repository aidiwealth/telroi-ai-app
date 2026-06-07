import { desc } from 'drizzle-orm';
import { requirePlatformAdmin } from '~/server/utils/platform';
import { useDb, schema } from '~/server/db';
export default defineEventHandler(async (event) => {
  await requirePlatformAdmin(event);
  const db = useDb();
  return await db.select().from(schema.numberInventory).orderBy(desc(schema.numberInventory.createdAt));
});
