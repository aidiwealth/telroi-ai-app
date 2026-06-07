import { eq } from 'drizzle-orm';
import { requireApiKey, hasScope } from '~/server/utils/apikey-auth';
import { apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
export default defineEventHandler(async (event) => {
  const ctx = await requireApiKey(event);
  if (!hasScope(ctx, 'vans:read')) throw apiError('forbidden', 'Key lacks vans:read', 403);
  const db = useDb();
  const rows = await db.select().from(schema.vans).where(eq(schema.vans.tenantId, ctx.tenantId));
  return { object: 'list', data: rows };
});
