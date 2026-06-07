// POST /api/admin/plan-features { key, startup, growth, custom } -> update one feature's plan matrix.
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { requirePlatformAdmin } from '~/server/utils/platform';
import { apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
const Body = z.object({ key: z.string(), startup: z.boolean(), growth: z.boolean(), custom: z.boolean() });
export default defineEventHandler(async (event) => {
  const admin = await requirePlatformAdmin(event);
  if (admin.role !== 'superadmin') throw apiError('forbidden', 'Superadmin required', 403);
  const p = Body.safeParse(await readBody(event));
  if (!p.success) throw apiError('invalid', 'Invalid feature');
  const db = useDb();
  await db.update(schema.planFeatures)
    .set({ startup: p.data.startup, growth: p.data.growth, custom: p.data.custom, updatedAt: new Date() })
    .where(eq(schema.planFeatures.key, p.data.key));
  return { ok: true };
});
