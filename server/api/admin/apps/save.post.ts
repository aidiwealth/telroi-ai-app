// POST /api/admin/apps/save -> create or update an app release (keyed by platform).
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { requireSuperAdmin } from '~/server/utils/platform';
import { apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
const Body = z.object({
  id: z.string().uuid().optional(),
  platform: z.string().min(2).max(20),
  name: z.string().min(1),
  description: z.string().optional(),
  groupLabel: z.enum(['Mobile', 'Desktop', 'Browser']).default('Mobile'),
  iconKey: z.enum(['apple', 'android', 'windows', 'linux', 'browser']).default('apple'),
  accent: z.string().default('#0A0A0B'),
  version: z.string().optional(),
  downloadUrl: z.string().url().optional().or(z.literal('')),
  requirement: z.string().optional(),
  fileSize: z.string().optional(),
  status: z.enum(['available', 'coming_soon', 'hidden']).default('available'),
  sortOrder: z.number().int().default(0)
});
export default defineEventHandler(async (event) => {
  await requireSuperAdmin(event);
  const p = Body.safeParse(await readBody(event));
  if (!p.success) throw apiError('invalid', p.error.issues[0]?.message || 'Invalid app data');
  const db = useDb();
  const d = p.data;
  const values = { platform: d.platform, name: d.name, description: d.description || null, groupLabel: d.groupLabel, iconKey: d.iconKey, accent: d.accent, version: d.version || null, downloadUrl: d.downloadUrl || null, requirement: d.requirement || null, fileSize: d.fileSize || null, status: d.status, sortOrder: d.sortOrder, updatedAt: new Date() };
  if (d.id) {
    await db.update(schema.appReleases).set(values).where(eq(schema.appReleases.id, d.id));
    return { ok: true, id: d.id };
  }
  // upsert by platform (unique)
  const [existing] = await db.select({ id: schema.appReleases.id }).from(schema.appReleases).where(eq(schema.appReleases.platform, d.platform)).limit(1);
  if (existing) { await db.update(schema.appReleases).set(values).where(eq(schema.appReleases.id, existing.id)); return { ok: true, id: existing.id }; }
  const [row] = await db.insert(schema.appReleases).values(values).returning({ id: schema.appReleases.id });
  return { ok: true, id: row.id };
});
