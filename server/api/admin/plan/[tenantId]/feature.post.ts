// POST /api/admin/plan/:tenantId/feature { key, enabled|null }
// Force a feature on/off for one client (null clears the override -> plan default).
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { requirePlatformAdmin } from '~/server/utils/platform';
import { apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
const Body = z.object({ key: z.string(), enabled: z.boolean().nullable() });
export default defineEventHandler(async (event) => {
  const admin = await requirePlatformAdmin(event);
  if (admin.role !== 'superadmin') throw apiError('forbidden', 'Superadmin required', 403);
  const tenantId = getRouterParam(event, 'tenantId')!;
  const p = Body.safeParse(await readBody(event));
  if (!p.success) throw apiError('invalid', 'Invalid');
  const db = useDb();
  if (p.data.enabled === null) {
    await db.delete(schema.tenantFeatureOverrides)
      .where(and(eq(schema.tenantFeatureOverrides.tenantId, tenantId), eq(schema.tenantFeatureOverrides.featureKey, p.data.key)));
    return { ok: true, cleared: true };
  }
  const [existing] = await db.select().from(schema.tenantFeatureOverrides)
    .where(and(eq(schema.tenantFeatureOverrides.tenantId, tenantId), eq(schema.tenantFeatureOverrides.featureKey, p.data.key))).limit(1);
  if (existing) {
    await db.update(schema.tenantFeatureOverrides).set({ enabled: p.data.enabled, updatedAt: new Date() }).where(eq(schema.tenantFeatureOverrides.id, existing.id));
  } else {
    await db.insert(schema.tenantFeatureOverrides).values({ tenantId, featureKey: p.data.key, enabled: p.data.enabled });
  }
  return { ok: true };
});
