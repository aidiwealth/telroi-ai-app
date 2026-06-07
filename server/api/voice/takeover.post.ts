// POST /api/voice/takeover { callid } -> a user/agent takes over an AI call.
import { z } from 'zod';
import { requireTenant, apiError } from '~/server/utils/api';
import { takeOverCall } from '~/server/utils/call-takeover';
const Body = z.object({ callid: z.string().min(1) });
export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  const p = Body.safeParse(await readBody(event));
  if (!p.success) throw apiError('invalid', 'callid required');
  // Resolve a friendly label for who took over.
  let label = 'Agent';
  try {
    const { useDb, schema } = await import('~/server/db');
    const { eq } = await import('drizzle-orm');
    const [u] = await useDb().select({ name: schema.users.name, email: schema.users.email }).from(schema.users).where(eq(schema.users.id, s.userId)).limit(1);
    label = u?.name || u?.email || 'Agent';
  } catch { /* */ }
  return await takeOverCall({ tenantId: s.tenantId, callid: p.data.callid, userId: s.userId, userLabel: label });
});
