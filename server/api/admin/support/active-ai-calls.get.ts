// GET /api/admin/support/active-ai-calls -> support AI calls a human can take over.
import { requirePlatformAdmin } from '~/server/utils/platform';
import { ensureSupportWorkspace } from '~/server/utils/support';
import { activeAiCalls } from '~/server/utils/call-takeover';
export default defineEventHandler(async (event) => {
  await requirePlatformAdmin(event);
  const ws = await ensureSupportWorkspace();
  return { calls: await activeAiCalls(ws.tenantId) };
});
