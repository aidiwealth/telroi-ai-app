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
      if (!tenantId) {
        // The number isn't assigned to any tenant, so we can't attribute or log
        // the call (call_events requires a tenant). Warn so this is visible
        // instead of silently dropped — the usual cause is a bought-but-unassigned
        // number. Assign it under Numbers to enable routing + logging.
        console.warn(`[telnyx webhook] ${eventType} for unassigned number (to=${to} from=${from}) — not logged. Assign this number to a tenant to enable routing + call logs.`);
      }
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

        // ---- Call Control IVR state machine (issue commands back to Telnyx) ----
        if (direction === 'in' && callId) {
          const cc = await import('~/server/utils/telnyx-cc');
          const { resolveInboundAction, resolveFlowNode } = await import('~/server/utils/inbound-routing');

          // Advance the flow given an InboundAction: speak/gather for IVR, transfer/answer for terminals.
          const drive = async (act: any) => {
            if (!act) { await cc.telnyxHangup(callId); return; }
            if (act.action === 'ivr' && act.ivr) {
              if (act.ivr.kind === 'say') { await cc.telnyxSpeak(callId, act.ivr.text || '', act.ivr.nextNodeId || null); return; }
              if (act.ivr.kind === 'menu') { await cc.telnyxGather(callId, act.ivr.text || 'Please choose an option.', act.ivr.nodeId || ''); return; }
              if (act.ivr.kind === 'voicemail') { await cc.telnyxSpeak(callId, act.ivr.text || 'Please leave a message.', null); return; }
            }
            if (act.action === 'dial_person' || act.action === 'dial_department') {
              if (act.dialTarget) { await cc.telnyxTransfer(callId, act.dialTarget); return; }
            }
            if (act.action === 'ai') {
              // AI over Telnyx requires media streaming (separate adapter). For now,
              // speak a brief message so the caller isn't dropped silently.
              await cc.telnyxSpeak(callId, 'Connecting you now.', null); return;
            }
            await cc.telnyxHangup(callId);
          };

          if (eventType === 'call.initiated') { await cc.telnyxAnswer(callId); return { ok: true }; }
          if (eventType === 'call.answered') { await drive(routeAction || await resolveInboundAction(tenantId, to)); return { ok: true }; }
          if (eventType === 'call.speak.ended') {
            const st = cc.decodeState(payload.client_state);
            if (st.n) { await drive(await resolveFlowNode(tenantId, to, st.n)); } else { await cc.telnyxHangup(callId); }
            return { ok: true };
          }
          if (eventType === 'call.gather.ended') {
            const st = cc.decodeState(payload.client_state);
            const digit = payload.digits || '';
            if (st.n && digit) {
              const menu = await resolveFlowNode(tenantId, to, st.n);
              const chosen = menu.ivr?.options?.find((o: any) => o.digit === String(digit));
              if (chosen?.nextNodeId) { await drive(await resolveFlowNode(tenantId, to, chosen.nextNodeId)); }
              else { await cc.telnyxSpeak(callId, 'Sorry, that was not a valid option. Goodbye.', null); }
            } else { await cc.telnyxHangup(callId); }
            return { ok: true };
          }
        }
      }
    } catch (e) { console.error('[telnyx webhook] log failed', e); }
  }
  return { ok: true, received: eventType || 'unknown' };
});
