import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { requirePlatformAdmin } from '~/server/utils/platform';
import { apiError } from '~/server/utils/api';
import { ensureSupportWorkspace } from '~/server/utils/support';
import { useDb, schema } from '~/server/db';
const Body = z.object({ status: z.enum(['live', 'paused', 'draft']) });
export default defineEventHandler(async (event) => {
  await requirePlatformAdmin(event);
  const ws = await ensureSupportWorkspace();
  const id = getRouterParam(event, 'id')!;
  const p = Body.safeParse(await readBody(event));
  if (!p.success) throw apiError('invalid', 'status required');
  const db = useDb();
  const [row] = await db.update(schema.vans).set({ status: p.data.status })
    .where(and(eq(schema.vans.id, id), eq(schema.vans.tenantId, ws.tenantId))).returning();
  return row;
});
