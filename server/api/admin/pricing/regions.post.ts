// POST /api/admin/pricing/regions
//
// A region's rate overrides. Null clears one, so a region can go back to the
// global figure without a row having to be deleted — and the difference between
// "inherits" and "set to zero" stays visible.
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { requireSuperAdmin } from '~/server/utils/platform';
import { apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';

const Body = z.object({
  region: z.string().min(2).max(4),
  // Micro-dollars, matching the global field. Nullable rather than optional:
  // absent means "leave it", null means "clear it back to the global rate",
  // and a form that could not say the second would make an override permanent.
  voiceOtpUsdMicro: z.number().int().nonnegative().nullable().optional(),
  voiceMinuteUsdMicro: z.number().int().nonnegative().nullable().optional(),
  notes: z.string().max(500).nullable().optional()
});

export default defineEventHandler(async (event) => {
  await requireSuperAdmin(event);
  const p = Body.safeParse(await readBody(event));
  if (!p.success) throw apiError('invalid', 'A region and its rates are required');

  const patch: any = { updatedAt: new Date() };
  if (p.data.voiceOtpUsdMicro !== undefined) patch.voiceOtpUsdMicro = p.data.voiceOtpUsdMicro;
  if (p.data.voiceMinuteUsdMicro !== undefined) patch.voiceMinuteUsdMicro = p.data.voiceMinuteUsdMicro;
  if (p.data.notes !== undefined) patch.notes = p.data.notes;

  const db = useDb();
  const [row] = await db.update(schema.regionRates).set(patch)
    .where(eq(schema.regionRates.region, p.data.region)).returning();
  if (!row) throw apiError('not_found', 'No such region', 404);
  return { region: row };
});
