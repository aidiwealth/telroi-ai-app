// GET /api/plan -> the tenant's effective plan, trial state, and feature map.
import { requireTenant } from '~/server/utils/api';
import { entitlementsFor } from '~/server/utils/entitlements';
import { useDb, schema } from '~/server/db';
import { eq } from 'drizzle-orm';
export default defineEventHandler(async (event) => {
  const s = await requireTenant(event);
  const db = useDb();
  const [t] = await db.select().from(schema.tenants).where(eq(schema.tenants.id, s.tenantId)).limit(1);
  const ent = await entitlementsFor(s.tenantId);
  return {
    plan: ent.plan,
    basePlan: t?.plan,
    planSelected: t?.planSelected ?? false,
    trial: ent.trial,
    trialDays: t?.trialDays ?? 7,
    features: ent.features
  };
});
