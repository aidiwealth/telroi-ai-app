// POST /api/admin/inventory/:id/reserve { reserved } -> keep a number out of
// what clients can buy.
//
// Carrier interop and OTP presenting numbers are ours, not stock: a client
// buying the number our verification calls present from would be a strange
// morning for both of us. The purchase path already claims only rows marked
// available, so reserving is enough to take one off the shelf while leaving it
// entirely usable by the platform.
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { requirePlatformAdmin } from '~/server/utils/platform';
import { apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
import { logEvent } from '~/server/utils/logs';

const Body = z.object({ reserved: z.boolean() });

export default defineEventHandler(async (event) => {
  const admin = await requirePlatformAdmin(event);
  const id = getRouterParam(event, 'id')!;
  const p = Body.safeParse(await readBody(event));
  if (!p.success) throw apiError('invalid', 'reserved must be true or false');

  const db = useDb();
  const [row] = await db.select().from(schema.numberInventory)
    .where(eq(schema.numberInventory.id, id)).limit(1);
  if (!row) throw apiError('not_found', 'Number not found', 404);

  // A number somebody owns is not ours to reserve — that would take it from them
  // rather than off the shelf.
  if (row.status === 'sold') throw apiError('sold', 'That number belongs to a workspace. Release it first.', 409);

  const next = p.data.reserved ? 'reserved' : 'available';
  await db.update(schema.numberInventory).set({ status: next })
    .where(eq(schema.numberInventory.id, id));

  await logEvent({
    kind: 'system', action: 'inventory.reserve',
    summary: `${admin.email} ${p.data.reserved ? 'reserved' : 'released'} ${row.telnum} ${p.data.reserved ? 'for platform use' : 'back to inventory'}`
  });

  return { ok: true, status: next };
});
