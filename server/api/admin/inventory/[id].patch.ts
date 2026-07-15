// PATCH /api/admin/inventory/:id { telnum }
// Fix a mistyped number. Only for numbers an admin keyed in by hand — an
// API-purchased number's digits refer to a real carrier purchase (provisionRef),
// so editing them here would leave us pointing at a number we don't own while
// still paying for the one we do. Those must be released and re-bought instead.
import { z } from 'zod';
import { and, eq, ne } from 'drizzle-orm';
import { requireSuperAdmin } from '~/server/utils/platform';
import { apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
import { detectRegion, providerAllowed, providersForRegion, regionLabel } from '~/server/utils/regions';

const Body = z.object({ telnum: z.string().min(3) });

export default defineEventHandler(async (event) => {
  await requireSuperAdmin(event);
  const id = getRouterParam(event, 'id') || '';
  const p = Body.safeParse(await readBody(event));
  if (!p.success) throw apiError('invalid', 'telnum required', 400);

  const telnum = p.data.telnum.trim();
  const db = useDb();

  const [row] = await db.select().from(schema.numberInventory).where(eq(schema.numberInventory.id, id)).limit(1);
  if (!row) throw apiError('not_found', 'Number not found', 404);

  // Guard 1: bought through a carrier API — the digits are not ours to rewrite.
  if (row.provisionRef) {
    throw apiError('not_editable',
      'This number was purchased through the carrier API, so its digits match a real purchase on that account. Release it and buy the correct number instead.', 400);
  }

  // Guard 2: someone owns it. Their callers dial the old number; their routing,
  // VAN and call history all reference it. Silently swapping the digits would
  // break their inbound calls with no trace.
  if (row.status === 'sold' || row.soldToTenantId) {
    throw apiError('not_editable',
      'This number is assigned to a client — changing it would break their inbound calls. Have them release it first.', 400);
  }

  // Region must still match the provider (same rule as adding).
  const region = detectRegion(telnum);
  if (!region) throw apiError('invalid', `Could not determine the region for ${telnum}.`, 400);
  if (!providerAllowed(region, row.provider)) {
    throw apiError('provider_mismatch',
      `${telnum} is a ${regionLabel(region)} number — it must be on ${providersForRegion(region).join(' or ')}, not ${row.provider}.`, 400);
  }

  // Guard 3: no duplicates (telnum is uniquely indexed anyway — fail clearly).
  const [clash] = await db.select({ id: schema.numberInventory.id }).from(schema.numberInventory)
    .where(and(eq(schema.numberInventory.telnum, telnum), ne(schema.numberInventory.id, id))).limit(1);
  if (clash) throw apiError('duplicate', `${telnum} is already in inventory.`, 409);

  const [updated] = await db.update(schema.numberInventory)
    .set({ telnum, region })
    .where(eq(schema.numberInventory.id, id))
    .returning();

  console.log(`[admin] inventory ${id}: telnum corrected ${row.telnum} -> ${telnum}`);
  return updated;
});
