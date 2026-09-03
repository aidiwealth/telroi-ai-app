// GET /api/admin/pricing/regions -> the per-region rate overrides.
//
// Null means "use the global figure", so the screen can show what a region
// inherits rather than an empty box somebody has to guess at.
import { asc } from 'drizzle-orm';
import { requireSuperAdmin } from '~/server/utils/platform';
import { useDb, schema } from '~/server/db';

export default defineEventHandler(async (event) => {
  await requireSuperAdmin(event);
  const rows = await useDb().select().from(schema.regionRates)
    .orderBy(asc(schema.regionRates.region));
  return { regions: rows };
});
