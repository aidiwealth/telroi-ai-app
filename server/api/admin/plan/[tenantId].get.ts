// GET /api/admin/plan/:tenantId -> effective entitlements + raw overrides for admin editing.
import { eq } from 'drizzle-orm';
import { requirePlatformAdmin } from '~/server/utils/platform';
import { useDb, schema } from '~/server/db';
import { entitlementsFor } from '~/server/utils/entitlements';
export default defineEventHandler(async (event) => {
  await requirePlatformAdmin(event);
  const tenantId = getRouterParam(event, 'tenantId')!;
  const db = useDb();
  const ent = await entitlementsFor(tenantId);
  const overrides = await db.select().from(schema.tenantFeatureOverrides).where(eq(schema.tenantFeatureOverrides.tenantId, tenantId));
  const ovMap: Record<string, boolean> = {};
  for (const o of overrides) ovMap[o.featureKey] = o.enabled;
  return { plan: ent.plan, features: ent.features, overrides: ovMap, trial: ent.trial };
});
