import { z } from 'zod';
import { requirePlatformAdmin } from '~/server/utils/platform';
import { apiError } from '~/server/utils/api';
import { ensureSupportWorkspace } from '~/server/utils/support';
import { useDb, schema } from '~/server/db';
import { resolveDefaultConnections } from '~/server/utils/voice/ai-brain';
const Body = z.object({
  name: z.string().min(1), greeting: z.string().optional(), systemPrompt: z.string().optional(), language: z.enum(['en-NG','yo-NG','ig-NG','ha-NG','sw-KE','am-ET','zu-ZA','af-ZA','en-US','en-GB','fr-FR','ar-XA','pt-PT','es-ES','de-DE','hi-IN','zh']).default('en-NG'),
  sttConnId: z.string().uuid().optional(), llmConnId: z.string().uuid().optional(), ttsConnId: z.string().uuid().optional(),
  fallback: z.record(z.any()).optional()
});
const DEFAULT_PROMPT = 'You are a warm, concise phone assistant. Keep every reply to one or two short sentences suitable for speaking aloud. Be helpful and natural. If the caller asks for a human or something you cannot handle, end your reply with [TRANSFER].';
export default defineEventHandler(async (event) => {
  await requirePlatformAdmin(event);
  const ws = await ensureSupportWorkspace();
  const p = Body.safeParse(await readBody(event));
  if (!p.success) throw apiError('invalid', 'Agent name required');
  const db = useDb();
  const defaults = await resolveDefaultConnections(ws.tenantId);
  const data = {
    ...p.data,
    llmConnId: p.data.llmConnId ?? defaults.llmConnId ?? undefined,
    sttConnId: p.data.sttConnId ?? defaults.sttConnId ?? undefined,
    ttsConnId: p.data.ttsConnId ?? defaults.ttsConnId ?? undefined,
    systemPrompt: p.data.systemPrompt ?? DEFAULT_PROMPT
  };
  const [row] = await db.insert(schema.aiAgents).values({ tenantId: ws.tenantId, ...data }).returning();
  return row;
});
