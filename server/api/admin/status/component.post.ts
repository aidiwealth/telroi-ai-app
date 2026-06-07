// POST /api/admin/status/component -> update the admin-editable bits of a
// PREDETERMINED component (by registry key). Title + uptime are derived from
// health checks and cannot be set here.
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { requirePlatformAdmin } from '~/server/utils/platform';
import { apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
import { getComponentDef } from '~/server/utils/status-registry';
const Body = z.object({
  key: z.string().min(1),
  description: z.string().optional(),
  sortOrder: z.number().int().optional(),
  manualStatus: z.enum(['operational','degraded','partial_outage','major_outage','maintenance']).nullable().optional()
});
export default defineEventHandler(async (event) => {
  await requirePlatformAdmin(event);
  const p = Body.safeParse(await readBody(event));
  if (!p.success) throw apiError('invalid', p.error.issues[0]?.message || 'Invalid');
  const d = p.data;
  if (!getComponentDef(d.key)) throw apiError('invalid', 'Unknown component'); // can't invent components
  const db = useDb();
  const patch: any = { key: d.key, updatedAt: new Date() };
  if (d.description !== undefined) patch.description = d.description || null;
  if (d.sortOrder !== undefined) patch.sortOrder = d.sortOrder;
  if (d.manualStatus !== undefined) patch.manualStatus = d.manualStatus; // null clears the override
  await db.insert(schema.statusComponents).values(patch)
    .onConflictDoUpdate({ target: schema.statusComponents.key, set: patch });
  return { ok: true, key: d.key };
});
