// POST /api/internal/notify-charge { id, seconds }
//
// Charges an answered notification. Called by the control app from the
// dialplan's hangup handler, because the pricing lives here: region rates,
// currency conversion and the postpaid credit check are all the web app's, and
// a second copy on the PBX is how two numbers that should agree stop agreeing.
//
// Only the call time. The synthesis was charged when it was made, since the
// vendor billed us for it whether or not anybody answered.
import { eq } from 'drizzle-orm';
import { useDb, schema } from '~/server/db';

export default defineEventHandler(async (event) => {
  const cfg = useRuntimeConfig() as any;
  const secret = (cfg.internalSecret as string) || (cfg.provisionAgentSecret as string) || '';
  if (!secret || getHeader(event, 'x-telroi-internal') !== secret) {
    throw createError({ statusCode: 401, statusMessage: 'unauthorized' });
  }

  const body = await readBody<{ id?: string; seconds?: number }>(event).catch(() => ({}));
  const id = String(body?.id || '');
  const seconds = Number(body?.seconds || 0);
  if (!id || seconds <= 0) return { ok: false, reason: 'id and seconds are required' };

  const db = useDb();
  const [row] = await db.select().from(schema.voiceNotifications)
    .where(eq(schema.voiceNotifications.id, id)).limit(1);
  if (!row) return { ok: false, reason: 'not_found' };
  // Charged once. A hangup handler that fires twice, or a retry after a
  // timeout, would otherwise bill the same call again.
  if (row.chargeMinor != null) return { ok: true, alreadyCharged: true };

  const { getPricing, notifyCostMinor } = await import('~/server/utils/pricing');
  const { getOrCreateWallet, debit } = await import('~/server/utils/wallet');
  const { detectRegion } = await import('~/server/utils/regions');

  // The destination's region, as OTP does: a Lagos business notifying a US
  // number pays what that call costs us.
  const known = ['NG', 'US', 'GB', 'CA'];
  const raw = detectRegion(row.toNumber);
  const region = known.includes(raw) && /^\+?(234|1|44)/.test(row.toNumber.replace(/[^\d+]/g, ''))
    ? raw : undefined;

  const pricing = await getPricing(row.tenantId, region);
  const wallet = await getOrCreateWallet(row.tenantId);
  const charge = notifyCostMinor(seconds, wallet.currency as any, pricing.ngnPerUsd, pricing.voiceMinuteUsdMicro);

  try {
    // An object, not positional arguments — called the other way, amountMinor
    // arrives undefined and the wallet refuses it as not a positive integer,
    // which is what every notification's minute did until now.
    await debit({
      tenantId: row.tenantId,
      amountMinor: charge,
      reason: 'voice_notification',
      // The notification id, so a hangup handler that fires twice charges once.
      reference: `notify:${id}`,
      meta: { to: row.toNumber, seconds }
    });
    await db.update(schema.voiceNotifications).set({ chargeMinor: charge })
      .where(eq(schema.voiceNotifications.id, id));
  } catch (e: any) {
    // Logged rather than thrown: the call has happened and refusing to record
    // it would leave a delivered notification looking unbilled forever.
    console.error('[notify-charge] not charged:', e?.message || e);
    return { ok: false, reason: 'charge_failed' };
  }
  return { ok: true, chargeMinor: charge };
});
