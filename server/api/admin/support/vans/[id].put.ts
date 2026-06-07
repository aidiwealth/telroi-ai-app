import { and, eq } from 'drizzle-orm';
import { requirePlatformAdmin } from '~/server/utils/platform';
import { ensureSupportWorkspace } from '~/server/utils/support';
import { useDb, schema } from '~/server/db';
export default defineEventHandler(async (event) => {
  await requirePlatformAdmin(event);
  const ws = await ensureSupportWorkspace();
  const id = getRouterParam(event, 'id')!;
  const db = useDb();
  const [row] = await db.update(schema.vans).set(await readBody(event))
    .where(and(eq(schema.vans.id, id), eq(schema.vans.tenantId, ws.tenantId))).returning();
  return row;
});
