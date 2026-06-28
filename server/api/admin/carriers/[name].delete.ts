// DELETE /api/admin/carriers/:name — remove a carrier (superadmin).
// Removes the trunk config from the PBX AND deletes the DB record.
import { eq } from 'drizzle-orm';
import { requirePlatformAdmin } from '~/server/utils/platform';
import { apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
import { agentCarrierRemove } from '~/server/utils/provision-agent';

export default defineEventHandler(async (event) => {
  const admin = await requirePlatformAdmin(event);
  if (admin.role !== 'superadmin') throw apiError('forbidden', 'Superadmin required', 403);
  const name = decodeURIComponent(getRouterParam(event, 'name') || '').trim();
  if (!name) throw apiError('bad_request', 'name required', 400);

  const db = useDb();
  const [existing] = await db.select().from(schema.carriers).where(eq(schema.carriers.name, name)).limit(1);
  if (!existing) throw apiError('not_found', 'Carrier not found', 404);

  let removed = false;
  try {
    const r = await agentCarrierRemove(name);
    removed = r.removed;
  } catch (e) {
    throw apiError('pbx_error', `PBX removal failed: ${(e as Error).message}`, 502);
  }

  await db.delete(schema.carriers).where(eq(schema.carriers.id, existing.id));
  return { ok: true, name, removedFromPbx: removed };
});
