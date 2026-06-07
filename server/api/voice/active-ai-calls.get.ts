// GET /api/voice/active-ai-calls -> AI-handled calls a human can take over.
import { requireTenant } from '~/server/utils/api';
import { activeAiCalls } from '~/server/utils/call-takeover';
export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  return { calls: await activeAiCalls(s.tenantId) };
});
