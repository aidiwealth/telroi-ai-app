// GET /api/agents -> list AI agent configs, enriched with per-role tier (byok vs managed).
import { eq } from 'drizzle-orm';
import { requireTenant } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
import { resolveAgentTier } from '~/server/utils/voice/ai-brain';

export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  const db = useDb();
  const rows = await db.select().from(schema.aiAgents).where(eq(schema.aiAgents.tenantId, s.tenantId));
  return await Promise.all(rows.map(async (a) => ({
    ...a,
    tier: await resolveAgentTier(s.tenantId, { llmConnId: a.llmConnId, sttConnId: a.sttConnId, ttsConnId: a.ttsConnId })
  })));
});
