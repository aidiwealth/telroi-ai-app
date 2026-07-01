// POST /api/agents -> create an AI agent. Auto-assigns STT/LLM/TTS from the
// tenant's ai_connections when not explicitly chosen, so it works out of the box.
import { z } from 'zod';
import { requireTenant, apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
import { resolveDefaultConnections } from '~/server/utils/voice/ai-brain';

const Body = z.object({
  name: z.string().min(1),
  greeting: z.string().optional(),
  systemPrompt: z.string().optional(),
  sttConnId: z.string().uuid().optional(),
  llmConnId: z.string().uuid().optional(),
  ttsConnId: z.string().uuid().optional(),
  fallback: z.record(z.any()).optional()
});

const DEFAULT_PROMPT = 'You are a warm, concise phone assistant. Keep every reply to one or two short sentences suitable for speaking aloud. Be helpful and natural. If the caller asks for a human or something you cannot handle, end your reply with [TRANSFER].';

export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  const p = Body.safeParse(await readBody(event));
  if (!p.success) throw apiError('invalid', 'Agent name required');
  const db = useDb();
  const defaults = await resolveDefaultConnections(s.tenantId);
  const data = {
    ...p.data,
    llmConnId: p.data.llmConnId ?? defaults.llmConnId ?? undefined,
    sttConnId: p.data.sttConnId ?? defaults.sttConnId ?? undefined,
    ttsConnId: p.data.ttsConnId ?? defaults.ttsConnId ?? undefined,
    systemPrompt: p.data.systemPrompt ?? DEFAULT_PROMPT
  };
  const [row] = await db.insert(schema.aiAgents).values({ tenantId: s.tenantId, ...data }).returning();
  return row;
});
