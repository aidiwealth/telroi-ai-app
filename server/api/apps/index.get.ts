// GET /api/apps -> the native-app download catalog for clients. Returns
// available + coming-soon entries (hidden ones are operator-only), ordered.
import { ne, asc } from 'drizzle-orm';
import { requireTenant } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
export default defineEventHandler(async (event) => {
  await requireTenant(event);
  const db = useDb();
  const rows = await db.select().from(schema.appReleases)
    .where(ne(schema.appReleases.status, 'hidden'))
    .orderBy(asc(schema.appReleases.sortOrder));
  return { apps: rows };
});
