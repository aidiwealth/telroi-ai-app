// POST /api/admin/plan/:tenantId { plan?, trialDays?, startTrial? }
// Operator sets a customer's plan, trial length (7/14/30), or starts a trial.
import { z } from 'zod';
import { TENANT_OVERRIDES, overrideSchema, applyOverrides } from '~/server/utils/tenant-overrides';
import { eq } from 'drizzle-orm';
import { requirePlatformAdmin } from '~/server/utils/platform';
import { apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
const Body = z.object({
  plan: z.enum(['startup', 'growth', 'custom']).optional(),
  // Postpaid is a credit decision, so it lives here with the other things only
  // an operator sets. Nulls are meaningful: turning it off should clear the
  // limit and the billing day rather than leave them lying around.
  postpaid: z.boolean().optional(),
  creditLimitMinor: z.number().int().min(0).nullable().optional(),
  billingDay: z.number().int().min(1).max(28).nullable().optional(),
  paymentTermsDays: z.number().int().min(1).max(90).nullable().optional(),
  trialDays: z.number().int().refine((n) => [7, 14, 30].includes(n), 'trialDays must be 7, 14 or 30').optional(),
  startTrial: z.boolean().optional(),  // (re)start a growth trial of trialDays length
  // Per-client payment gateway override. 'default' clears it (use platform default).
  paymentProvider: z.enum(['default', 'stripe', 'paystack', 'monnify']).optional(),
  // Per-client allowances — sandbox and trial. Declared once in tenant-overrides
  // so the schema and the patch below can't disagree: adding one by hand in two
  // places and forgetting the second meant the form took a value and the endpoint
  // dropped it, silently.  null clears an override and falls back to the platform
  // default set under Settings.
  ...overrideSchema(TENANT_OVERRIDES, true)
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
  applyOverrides(TENANT_OVERRIDES, p.data as any, patch);
  if (p.data.trialDays) patch.trialDays = p.data.trialDays;

  // Postpaid. Turning it off clears the limit and the billing day rather than
  // leaving them behind: a stale credit limit on a prepaid account is a number
  // that means nothing until somebody turns postpaid back on and trusts it.
  if (p.data.postpaid !== undefined) {
    patch.postpaid = p.data.postpaid;
    if (p.data.postpaid) {
      if (!t.postpaidSince) patch.postpaidSince = new Date();
    } else {
      patch.creditLimitMinor = null;
      patch.billingDay = null;
      patch.paymentTermsDays = null;
      patch.postpaidSince = null;
    }
  }
  if (p.data.creditLimitMinor !== undefined && p.data.postpaid !== false) patch.creditLimitMinor = p.data.creditLimitMinor;
  if (p.data.billingDay !== undefined && p.data.postpaid !== false) patch.billingDay = p.data.billingDay;
  if (p.data.paymentTermsDays !== undefined && p.data.postpaid !== false) patch.paymentTermsDays = p.data.paymentTermsDays;
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
