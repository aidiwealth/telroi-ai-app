import { requirePlatformAdmin } from '~/server/utils/platform';
import { useDb, schema } from '~/server/db';
import { DEFAULT_FEATURES } from '~/server/utils/entitlements';
export default defineEventHandler(async (event) => {
  await requirePlatformAdmin(event);
  const db = useDb();
  let rows = await db.select().from(schema.planFeatures);
  if (!rows.length) rows = DEFAULT_FEATURES as any;
  return { features: rows };
});
