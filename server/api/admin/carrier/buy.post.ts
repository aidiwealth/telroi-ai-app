// POST /api/admin/carrier/buy { provider, telnum, region, monthlyUsdMinorOverride? }
// Purchases a number on the master Twilio/Telnyx account (CHARGES your carrier
// account), registers the inbound webhook, then adds it to inventory as
// available + provisioned so clients can self-purchase it. Superadmin only.
import { z } from 'zod';
import { requirePlatformAdmin } from '~/server/utils/platform';
import { apiError } from '~/server/utils/api';
import { useDb, schema } from '~/server/db';
import { masterCarrierCreds } from '~/server/utils/platform';
import { twilioProvision, telnyxProvision } from '~/server/utils/providers';
import { detectRegion } from '~/server/utils/regions';

const Body = z.object({
  provider: z.enum(['twilio', 'telnyx']),
  telnum: z.string().min(4),
  region: z.enum(['US', 'CA', 'GB']).optional(),
  monthlyUsdMinorOverride: z.number().int().positive().optional()
});

export default defineEventHandler(async (event) => {
  const admin = await requirePlatformAdmin(event);
  if (admin.role !== 'superadmin') throw apiError('forbidden', 'Superadmin required', 403);
  const p = Body.safeParse(await readBody(event));
  if (!p.success) throw apiError('invalid', 'provider + telnum required');
  const region = p.data.region || detectRegion(p.data.telnum);
  if (region === 'NG') throw apiError('not_allowed', 'Nigerian numbers are added manually, not bought via carrier.', 400);

  const master = await masterCarrierCreds();
  const db = useDb();
  const base = (useRuntimeConfig().public as any).appBaseUrl;

  let ref: string | undefined;
  try {
    if (p.data.provider === 'twilio') {
      if (!master?.twilio) throw apiError('no_carrier', 'Twilio master account not configured.', 400);
      ({ ref } = await twilioProvision.buyNumber({ ...master.twilio }, p.data.telnum));
      try { await twilioProvision.setVoiceWebhook({ ...master.twilio }, p.data.telnum, `${base}/api/webhooks/twilio/voice`); } catch { /* set manually in console */ }
    } else {
      if (!master?.telnyx) throw apiError('no_carrier', 'Telnyx master account not configured.', 400);
      ({ ref } = await telnyxProvision.buyNumber({ ...master.telnyx }, p.data.telnum));
      try { await telnyxProvision.setVoiceWebhook({ ...master.telnyx }, p.data.telnum, `${base}/api/webhooks/telnyx/voice`); } catch { /* set manually */ }
    }
  } catch (e: any) {
    if (e?.statusCode === 400) throw e;
    throw apiError('buy_failed', e?.message || 'Carrier purchase failed', 502);
  }

  const [row] = await db.insert(schema.numberInventory).values({
    telnum: p.data.telnum, region, provider: p.data.provider,
    monthlyUsdMinorOverride: p.data.monthlyUsdMinorOverride ?? null,
    status: 'available', provisionStatus: 'provisioned', provisionRef: ref || null
  }).onConflictDoNothing().returning();

  return { ok: true, number: row, carrierRef: ref };
});
