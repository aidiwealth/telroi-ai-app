// POST /api/admin/carrier/search { provider, country, areaCode?, contains? }
// Live search of Twilio/Telnyx for purchasable numbers. Superadmin only.
// Nigeria is NOT searchable here — NG numbers are added manually (Digidite).
import { z } from 'zod';
import { requirePlatformAdmin } from '~/server/utils/platform';
import { apiError } from '~/server/utils/api';
import { masterCarrierCreds } from '~/server/utils/platform';
import { twilioProvision, telnyxProvision } from '~/server/utils/providers';

const Body = z.object({
  provider: z.enum(['twilio', 'telnyx']),
  country: z.string().min(2).max(2),
  areaCode: z.string().optional(),
  contains: z.string().optional(),
  limit: z.number().int().min(1).max(50).optional()
});

export default defineEventHandler(async (event) => {
  const admin = await requirePlatformAdmin(event);
  if (admin.role !== 'superadmin') throw apiError('forbidden', 'Superadmin required', 403);
  const p = Body.safeParse(await readBody(event));
  if (!p.success) throw apiError('invalid', 'provider + 2-letter country required');
  if (p.data.country.toUpperCase() === 'NG') {
    throw apiError('not_allowed', 'Nigerian numbers are added manually (Digidite), not searched on a carrier.', 400);
  }

  const master = await masterCarrierCreds();
  try {
    if (p.data.provider === 'twilio') {
      if (!master?.twilio) throw apiError('no_carrier', 'Twilio master account not configured in Settings.', 400);
      return { numbers: await twilioProvision.searchAvailable({ ...master.twilio }, p.data) };
    }
    if (!master?.telnyx) throw apiError('no_carrier', 'Telnyx master account not configured in Settings.', 400);
    return { numbers: await telnyxProvision.searchAvailable({ ...master.telnyx }, p.data) };
  } catch (e: any) {
    if (e?.statusCode === 400 || e?.statusCode === 403) throw e;
    throw apiError('search_failed', e?.message || 'Carrier search failed', 502);
  }
});
