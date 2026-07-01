// POST /api/agents -> create an AI agent.
// The client explicitly picks a tier:
//   - 'byok'    : runs on the tenant's own provider keys (zero Telroi cost). We
//                 auto-assign connections; if none exist the agent's roles are
//                 'unavailable' until they add a key (NO silent managed fallback).
//   - 'managed' : runs on Telroi's platform keys, billed to the tenant's wallet.
//                 Requires a wallet with a positive balance.
import { z } from 'zod';
import { requireTenant, apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
import { resolveDefaultConnections } from '~/server/utils/voice/ai-brain';
import { getOrCreateWallet } from '~/server/utils/wallet';

const Body = z.object({
  name: z.string().min(1),
  greeting: z.string().optional(),
  systemPrompt: z.string().optional(),
  tier: z.enum(['byok', 'managed']).default('byok'),
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
  const tier = p.data.tier;

  if (tier === 'managed') {
    const wallet = await getOrCreateWallet(s.tenantId);
    if (!wallet || wallet.balanceMinor <= 0) {
      throw apiError('wallet_required', 'Managed agents run on Telroi\'s AI at a per-use cost billed to your wallet. Please top up your wallet before creating a managed agent.', 402);
    }
  }

  let conns = { llmConnId: undefined as string | undefined, sttConnId: undefined as string | undefined, ttsConnId: undefined as string | undefined };
  if (tier === 'byok') {
    const defaults = await resolveDefaultConnections(s.tenantId);
    conns = {
      llmConnId: p.data.llmConnId ?? defaults.llmConnId ?? undefined,
      sttConnId: p.data.sttConnId ?? defaults.sttConnId ?? undefined,
      ttsConnId: p.data.ttsConnId ?? defaults.ttsConnId ?? undefined
    };
  }

  const [row] = await db.insert(schema.aiAgents).values({
    tenantId: s.tenantId,
    name: p.data.name,
    greeting: p.data.greeting,
    systemPrompt: p.data.systemPrompt ?? DEFAULT_PROMPT,
    tier,
    fallback: p.data.fallback,
    ...conns
  }).returning();
  return row;
});
