// POST /v1/notifications { to, message } -> place a call that speaks a message.
//
// Distinct from /v1/otp, and not a variation of it. OTP reads digits from files
// that already exist, so the code never leaves our machine and volume costs
// only carrier minutes. A notification says something different every time, so
// it is synthesised, charged for the speech as well as the call, and rate
// limited more tightly — a call nobody asked for is closer to outbound
// campaigning than to verification, and the same number-use rules apply.
import { z } from 'zod';
import { requireApiKey, hasScope } from '~/server/utils/apikey-auth';
import { apiError } from '~/server/utils/api';
import { MAX_NOTIFY_CHARS } from '~/server/utils/voice/notify-service';

const Body = z.object({
  to: z.string().min(3),
  message: z.string().min(1).max(MAX_NOTIFY_CHARS)
});

export default defineEventHandler(async (event) => {
  const ctx = await requireApiKey(event);
  if (!hasScope(ctx, 'notifications:write')) {
    throw apiError('forbidden', 'Key lacks notifications:write', 403);
  }

  const p = Body.safeParse(await readBody(event));
  if (!p.success) {
    throw apiError('invalid', `to (E.164 destination) and message (up to ${MAX_NOTIFY_CHARS} characters) are required`);
  }

  const { hasFeature } = await import('~/server/utils/entitlements');
  if (!(await hasFeature(ctx.tenantId, 'notifications'))) {
    throw apiError('feature_locked', 'Voice notifications are part of Telroi One. Upgrade to unlock.', 402);
  }

  // What this will cost, before it is sent. Customers should not first learn
  // the unit count at invoice time — the measured audio remains authoritative,
  // but the estimate removes the surprise that generates disputes.
  const { estimateNotifySeconds, notifyUnits } = await import('~/server/utils/pricing');
  const estimatedUnits = notifyUnits(p.data.message.length, estimateNotifySeconds(p.data.message));

  if (ctx.env === 'sandbox') {
    return {
      object: 'notification', simulated: true, livemode: false,
      id: `ntf_test_${Math.random().toString(36).slice(2, 12)}`,
      to: p.data.to, status: 'delivered', characters: p.data.message.length, estimated_units: estimatedUnits
    };
  }

  const { sendVoiceNotification } = await import('~/server/utils/voice/notify-service');
  const r = await sendVoiceNotification(ctx.tenantId, p.data.to, p.data.message);
  if (!r.ok) {
    if ((r.error || '').startsWith('rate_limited')) {
      throw apiError('rate_limited', 'Too many notifications to this number. Try again shortly.', 429);
    }
    if (r.error === 'insufficient_funds') throw apiError('insufficient_funds', 'Not enough balance to place this call.', 402);
    if (r.error === 'message_too_long') throw apiError('invalid', `message must be ${MAX_NOTIFY_CHARS} characters or fewer`);
    throw apiError('failed', r.error || 'The notification could not be placed.', 502);
  }

  // Dialing rather than delivered: the call has been placed and nobody has
  // answered yet. The notification.completed webhook says how it ended.
  return { object: 'notification', livemode: true, id: r.id, to: p.data.to, status: 'dialing', characters: p.data.message.length, estimated_units: estimatedUnits };
});
