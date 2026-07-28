// GET /api/admin/support/agents -> support AI agents, enriched with per-role tier
// (byok vs managed) exactly as the client endpoint does. Without the enrichment
// the editor read a tier that wasn't there and reported every provider as unset,
// however carefully they'd been configured.
import { eq } from 'drizzle-orm';
import { requirePlatformAdmin } from '~/server/utils/platform';
import { ensureSupportWorkspace } from '~/server/utils/support';
import { useDb, schema } from '~/server/db';
import { resolveAgentTier } from '~/server/utils/voice/ai-brain';

export default defineEventHandler(async (event) => {
  await requirePlatformAdmin(event);
  const ws = await ensureSupportWorkspace();
  const db = useDb();
  const rows = await db.select().from(schema.aiAgents).where(eq(schema.aiAgents.tenantId, ws.tenantId));
  return await Promise.all(rows.map(async (a) => ({
    ...a,
    tier: await resolveAgentTier(ws.tenantId, { llmConnId: a.llmConnId, sttConnId: a.sttConnId, ttsConnId: a.ttsConnId })
  })));
});
