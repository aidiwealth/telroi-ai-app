import { z } from 'zod';
import { requireApiKey, hasScope } from '~/server/utils/apikey-auth';
import { apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
const Body = z.object({
  name: z.string().min(1), telnum: z.string().min(3),
  provider: z.enum(['telroi','twilio','telnyx']).default('telroi'),
  agentId: z.string().uuid().optional(), escalateTo: z.string().optional()
});
export default defineEventHandler(async (event) => {
  const ctx = await requireApiKey(event);
  if (!hasScope(ctx, 'vans:write')) throw apiError('forbidden', 'Key lacks vans:write', 403);
  const p = Body.safeParse(await readBody(event));
  if (!p.success) throw apiError('invalid', 'name and telnum required');
  const db = useDb();
  const [row] = await db.insert(schema.vans).values({ tenantId: ctx.tenantId, ...p.data }).returning();
  return { object: 'van', ...row };
});
