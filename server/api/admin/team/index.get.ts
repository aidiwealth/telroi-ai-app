// GET /api/admin/team -> list platform admins (operator team). Any admin can view.
import { desc } from 'drizzle-orm';
import { requirePlatformAdmin } from '~/server/utils/platform';
import { useDb, schema } from '~/server/db';

export default defineEventHandler(async (event) => {
  await requirePlatformAdmin(event);
  const db = useDb();
  const admins = await db.select().from(schema.platformAdmins).orderBy(desc(schema.platformAdmins.createdAt));
  return { admins: admins.map((a) => ({ id: a.id, email: a.email, role: a.role, createdAt: a.createdAt })) };
});
