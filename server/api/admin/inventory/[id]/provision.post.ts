// POST /api/admin/inventory/:id/provision -> mark a number ready to assign.
//
// Numbers are ALREADY purchased + provisioned on their carrier/PBX out-of-band
// (Twilio/Telnyx in their consoles; Telroi on Digidite). This endpoint does NOT
// call any carrier API — it simply marks the inventory row as provisioned in our
// DB so it can be sold/assigned to a client. Superadmin only.
import { eq } from 'drizzle-orm';
import { requirePlatformAdmin } from '~/server/utils/platform';
import { apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';

export default defineEventHandler(async (event) => {
  const admin = await requirePlatformAdmin(event);
  if (admin.role !== 'superadmin') throw apiError('forbidden', 'Superadmin required', 403);
  const id = getRouterParam(event, 'id')!;
  const db = useDb();

  const [num] = await db.select().from(schema.numberInventory).where(eq(schema.numberInventory.id, id)).limit(1);
  if (!num) throw apiError('not_found', 'Number not found', 404);

  // Pure local marking — the number is already live on its carrier/PBX.
  const ref = `${num.provider}:${num.telnum}`;
  const [updated] = await db.update(schema.numberInventory)
    .set({ provisionStatus: 'provisioned', provisionRef: ref })
    .where(eq(schema.numberInventory.id, id)).returning();

  return { ok: true, number: updated };
});
