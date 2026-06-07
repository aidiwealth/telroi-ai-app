// GET /api/admin/apps -> full app-release catalog for operators (incl. hidden).
import { asc } from 'drizzle-orm';
import { requireSuperAdmin } from '~/server/utils/platform';
import { useDb, schema } from '~/server/db';
export default defineEventHandler(async (event) => {
  await requireSuperAdmin(event);
  const db = useDb();
  const rows = await db.select().from(schema.appReleases).orderBy(asc(schema.appReleases.sortOrder));
  return { apps: rows };
});
