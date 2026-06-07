// Telnyx Call Control webhook. Telnyx POSTs call lifecycle events:
//   call.initiated -> ringing, call.answered -> answered, call.hangup -> completed
// We attribute inbound calls to the tenant owning the destination number and
// upsert one row per call_control_id. Verified via the Telnyx-Signature header.
import { upsertCallEvent, tenantForNumber, normalizeStatus } from '~/server/utils/call-log';

export default defineEventHandler(async (event) => {
  const body = await readBody<any>(event).catch(() => ({}));
  const rawBody = (event as any)._telnyxRawBody;

  try {
    const { verifyTelnyxSignature } = await import('~/server/utils/webhook-verify');
    const ok = await verifyTelnyxSignature(event, rawBody);
    if (ok === false) { setResponseStatus(event, 403); return { ok: false, reason: 'invalid signature' }; }
  } catch { /* proceed */ }

  const data = body?.data;
  const eventType = data?.event_type as string;
  const payload = data?.payload || {};
  const callId = payload.call_control_id || payload.call_leg_id || payload.call_session_id;
  const direction = payload.direction === 'incoming' ? 'in' : 'out';
  const to = payload.to;
  const from = payload.from;

  if (callId && eventType) {
    try {
      // Attribute to the tenant owning the destination (inbound) or source (outbound).
      const numberToMatch = direction === 'in' ? to : from;
      const tenantId = await tenantForNumber(numberToMatch);
      if (tenantId) {
        // On an incoming call, resolve the UNIFIED route so the Call Control
        // issuer knows how to handle it (AI / person / department) — same model
        // as every other carrier.
        let routeAction: any = undefined;
        if (direction === 'in' && eventType === 'call.initiated' && to) {
          try {
            const { resolveInboundAction } = await import('~/server/utils/inbound-routing');
            routeAction = await resolveInboundAction(tenantId, to);
          } catch { /* */ }
        }
        await upsertCallEvent({
          tenantId, callid: callId, carrier: 'telnyx', direction,
          phone: direction === 'in' ? from : to,
          status: normalizeStatus('telnyx', eventType),
          raw: { eventType, to, from, route: routeAction }
        });
        if (routeAction) return { ok: true, received: eventType, route: routeAction };
      }
    } catch (e) { console.error('[telnyx webhook] log failed', e); }
  }
  return { ok: true, received: eventType || 'unknown' };
});
