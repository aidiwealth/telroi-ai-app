// POST /api/admin/inventory { numbers, provider, regionOverride?, monthlyUsdMinorOverride? }
// Admin bulk-adds numbers ALREADY provisioned on a carrier. The provider is the
// admin's infrastructure choice (Telroi PBX / Twilio / Telnyx ) and is
// validated against the number's region. Customers never see the provider.
import { z } from 'zod';
import { requirePlatformAdmin } from '~/server/utils/platform';
import { useDb, schema } from '~/server/db';
import { apiError } from '~/server/utils/api';
import { detectRegion, providerAllowed, providersForRegion, regionLabel } from '~/server/utils/regions';

const Body = z.object({
  numbers: z.string().min(3),
  provider: z.enum(['telroi', 'twilio', 'telnyx', 'asterisk']),
  regionOverride: z.enum(['NG', 'US', 'CA', 'GB']).optional(),
  monthlyUsdMinorOverride: z.number().int().positive().optional()
});

export default defineEventHandler(async (event) => {
  await requirePlatformAdmin(event);
  const p = Body.safeParse(await readBody(event));
  if (!p.success) throw apiError('invalid', 'Provide numbers and the carrier they are provisioned on');

  const list = [...new Set(p.data.numbers.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean))];
  if (!list.length) throw apiError('invalid', 'No valid numbers found');

  // Validate the chosen carrier is valid for each number's region.
  const rows = list.map((telnum) => {
    const region = p.data.regionOverride || detectRegion(telnum);
    if (!providerAllowed(region, p.data.provider)) {
      throw apiError('provider_mismatch',
        `${telnum} is a ${regionLabel(region)} number — it must be on ${providersForRegion(region).join(' or ')}, not ${p.data.provider}.`, 400);
    }
    return {
      telnum, region, provider: p.data.provider,
      monthlyUsdMinorOverride: p.data.monthlyUsdMinorOverride ?? null,
      status: 'available' as const
    };
  });

  const db = useDb();
  const inserted = await db.insert(schema.numberInventory).values(rows).onConflictDoNothing().returning();
  return { added: inserted.length, skipped: list.length - inserted.length, rows: inserted };
});
