// GET /api/voice/capacity?tenantId=... -> { capacity, inUse, available, ok }
// Internal endpoint the control-app calls before connecting an inbound AI call,
// so inbound calls respect the tenant's paid concurrent-channel limit (the same
// unified count used by the dialer/widget/API paths). Auth: shared secret header
// (x-telroi-internal), identical to /api/voice/ai/turn.
import { eq } from 'drizzle-orm';
import { useDb, schema } from '~/server/db';
import { channelUsage } from '~/server/utils/channel-limits';

export default defineEventHandler(async (event) => {
  const cfg = useRuntimeConfig() as any;
  const secret = (cfg.internalSecret as string) || (cfg.provisionAgentSecret as string) || '';
  const given = getHeader(event, 'x-telroi-internal') || '';
  if (!secret || given !== secret) throw createError({ statusCode: 401, statusMessage: 'unauthorized' });

  const tenantId = getQuery(event).tenantId as string;
  if (!tenantId) throw createError({ statusCode: 400, statusMessage: 'tenantId required' });
  const u = await channelUsage(tenantId);

  // Internal workspaces — our own support desk — aren't metered. The widget path
  // already skipped them, so a phone call was refused for being at capacity while
  // a web call to the same agents went through.
  const { useDb, schema } = await import('~/server/db');
  const { eq } = await import('drizzle-orm');
  const [t] = await useDb().select({ isInternal: schema.tenants.isInternal })
    .from(schema.tenants).where(eq(schema.tenants.id, tenantId)).limit(1);
  if (t?.isInternal) return { ...u, ok: true };

  // Whether managed AI can run, asked at the same moment as capacity because the
  // control-app decides both together: a workspace whose trial allowance is spent
  // and whose wallet is empty should reach a person rather than an AI that can't
  // answer. Only managed usage is ours to gate — a client on their own keys pays
  // their providers directly and we have nothing to withhold.
  let ai = true;
  let aiReason: string | null = null;
  try {
    const { trialAiStatus } = await import('~/server/utils/trial-ai');
    const trial = await trialAiStatus(tenantId);
    if (trial.onTrial) {
      if (trial.exhausted) { ai = false; aiReason = 'trial_allowance_spent'; }
    } else {
      const [w] = await useDb().select({ balanceMinor: schema.wallets.balanceMinor })
        .from(schema.wallets).where(eq(schema.wallets.tenantId, tenantId)).limit(1);
      if (!w || w.balanceMinor <= 0) { ai = false; aiReason = 'wallet_empty'; }
    }
  } catch { /* an uncertain answer shouldn't silence an AI that might work */ }

  return { ...u, ok: u.capacity === 0 ? false : u.inUse < u.capacity, ai, aiReason };
});
