// POST /api/vans -> create a Virtual AI Number
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { requireTenant, apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
const Body = z.object({
  name: z.string().min(1),
  telnum: z.string().min(3),
  agentId: z.string().uuid().optional(),
  languages: z.array(z.string()).optional(),
  escalateMode: z.enum(['none','endpoint','phone','ring_all']).optional(),
  escalateTo: z.string().optional(),
  escalateAfter: z.number().int().min(0).optional(),
  crmWriteback: z.boolean().optional()
});
export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  // Sandbox workspaces get a limited number of live AI agents — enough to prove
  // the product works, not enough to run on. Checked before the entitlement gate
  // so the caller gets the more useful of the two messages.
  const { sandboxStatus } = await import('~/server/utils/sandbox-limits');
  const sbx = await sandboxStatus(s.tenantId);
  if (sbx.sandbox && sbx.agentsExhausted) {
    throw apiError('sandbox_limit',
      `Sandbox workspaces can run ${sbx.agentCap} live AI number${sbx.agentCap === 1 ? '' : 's'}. Go live to add more.`, 403);
  }

  const { aiActive } = await import('~/server/utils/entitlements');
  const gate = await aiActive(s.tenantId);
  if (!gate.ok) throw apiError('forbidden', 'AI features require an active subscription. Choose a plan to enable AI.', 403);
  const p = Body.safeParse(await readBody(event));
  if (!p.success) throw apiError('invalid', 'VAN name and number required');
  const db = useDb();

  // The number must be one the tenant owns. Its carrier is whatever it was
  // provisioned on (admin-set) — the customer never chooses it; we use it.
  const [sub] = await db.select().from(schema.numberSubscriptions)
    .where(and(eq(schema.numberSubscriptions.telnum, p.data.telnum), eq(schema.numberSubscriptions.tenantId, s.tenantId)))
    .limit(1);
  if (!sub) throw apiError('not_owned', 'Buy this number on the Numbers page before assigning it.', 400);

  // vans.provider is a provider_kind enum (telroi | twilio | telnyx) — "who owns
  // the number" at the platform level, NOT the specific carrier. number_
  // subscriptions.provider holds the carrier (kasooko, ruach, twilio, …), so map
  // it: twilio/telnyx pass through; every other carrier is Telroi-provisioned.
  const providerKind = (sub.provider === 'twilio' || sub.provider === 'telnyx') ? sub.provider : 'telroi';

  const [row] = await db.insert(schema.vans).values({
    tenantId: s.tenantId, ...p.data, provider: providerKind
  }).returning();
  const { touchActivity } = await import('~/server/utils/activity');
  await touchActivity(s.tenantId);
  return row;
});
