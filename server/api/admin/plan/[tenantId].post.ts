// POST /api/admin/plan/:tenantId { plan?, trialDays?, startTrial? }
// Operator sets a customer's plan, trial length (7/14/30), or starts a trial.
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { requirePlatformAdmin } from '~/server/utils/platform';
import { apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
const Body = z.object({
  plan: z.enum(['startup', 'growth', 'custom']).optional(),
  trialDays: z.number().int().refine((n) => [7, 14, 30].includes(n), 'trialDays must be 7, 14 or 30').optional(),
  startTrial: z.boolean().optional(),  // (re)start a growth trial of trialDays length
  // Per-client payment gateway override. 'default' clears it (use platform default).
  paymentProvider: z.enum(['default', 'stripe', 'paystack', 'monnify']).optional(),
  // Sandbox allowances for this client. null clears the override so they inherit
  // the platform default set under Settings -> Telroi One.
  sandboxCallCap: z.number().int().min(0).nullable().optional(),
  sandboxAgentCap: z.number().int().min(0).nullable().optional()
});
export default defineEventHandler(async (event) => {
  const admin = await requirePlatformAdmin(event);
  if (admin.role !== 'superadmin') throw apiError('forbidden', 'Superadmin required', 403);
  const tenantId = getRouterParam(event, 'tenantId')!;
  const p = Body.safeParse(await readBody(event));
  if (!p.success) throw apiError('invalid', p.error.issues[0]?.message || 'Invalid');
  const db = useDb();
  const [t] = await db.select().from(schema.tenants).where(eq(schema.tenants.id, tenantId)).limit(1);
  if (!t) throw apiError('not_found', 'Workspace not found', 404);

  const patch: any = {};
  if (p.data.sandboxCallCap !== undefined) patch.sandboxCallCap = p.data.sandboxCallCap;
  if (p.data.sandboxAgentCap !== undefined) patch.sandboxAgentCap = p.data.sandboxAgentCap;
  if (p.data.trialDays) patch.trialDays = p.data.trialDays;
  if (p.data.plan) { patch.plan = p.data.plan; patch.trialPlan = null; patch.trialEndsAt = null; }
  if (p.data.startTrial) {
    const days = p.data.trialDays || t.trialDays || 7;
    const ends = new Date(); ends.setDate(ends.getDate() + days);
    patch.trialPlan = 'growth'; patch.trialEndsAt = ends; patch.plan = 'startup'; patch.trialDays = days;
  }
  if (p.data.paymentProvider) patch.paymentProviderOverride = p.data.paymentProvider === 'default' ? null : p.data.paymentProvider;
  await db.update(schema.tenants).set(patch).where(eq(schema.tenants.id, tenantId));
  return { ok: true };
});
