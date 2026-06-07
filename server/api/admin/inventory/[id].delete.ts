import { and, eq } from 'drizzle-orm';
import { requirePlatformAdmin } from '~/server/utils/platform';
import { useDb, schema } from '~/server/db';
export default defineEventHandler(async (event) => {
  await requirePlatformAdmin(event);
  const id = getRouterParam(event, 'id')!;
  const db = useDb();
  await db.delete(schema.numberInventory)
    .where(and(eq(schema.numberInventory.id, id), eq(schema.numberInventory.status, 'available')));
  return { ok: true };
});
