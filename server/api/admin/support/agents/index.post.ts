import { z } from 'zod';
import { requirePlatformAdmin } from '~/server/utils/platform';
import { apiError } from '~/server/utils/api';
import { ensureSupportWorkspace } from '~/server/utils/support';
import { useDb, schema } from '~/server/db';
const Body = z.object({
  name: z.string().min(1), greeting: z.string().optional(), systemPrompt: z.string().optional(),
  sttConnId: z.string().uuid().optional(), llmConnId: z.string().uuid().optional(), ttsConnId: z.string().uuid().optional(),
  fallback: z.record(z.any()).optional()
});
export default defineEventHandler(async (event) => {
  await requirePlatformAdmin(event);
  const ws = await ensureSupportWorkspace();
  const p = Body.safeParse(await readBody(event));
  if (!p.success) throw apiError('invalid', 'Agent name required');
  const db = useDb();
  const [row] = await db.insert(schema.aiAgents).values({ tenantId: ws.tenantId, ...p.data }).returning();
  return row;
});
