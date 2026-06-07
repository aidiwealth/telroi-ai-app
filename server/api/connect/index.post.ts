// POST /api/connect -> create a Connect flow
import { z } from 'zod';
import { requireTenant, apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
const Body = z.object({
  name: z.string().min(1),
  telnum: z.string().optional(),
  nodes: z.array(z.any()).optional(),
  workflows: z.array(z.any()).optional()
});
export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  const p = Body.safeParse(await readBody(event));
  if (!p.success) throw apiError('invalid', 'Flow name required');
  const db = useDb();
  const [row] = await db.insert(schema.connectFlows).values({ tenantId: s.tenantId, ...p.data }).returning();
  return row;
});
